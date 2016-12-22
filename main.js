/*jslint browser: true*/
/*global Tangram */
var picking = false;
map = (function () {
// (function () {
    // 'use strict';

    // defaults
    var map_start_location = [37.8090, -122.2220, 12]; // Oakland
    var style_file = 'walkabout-style.yaml';

    /*** URL parsing ***/

    // convert tile coordinates to lat-lng
    // from http://gis.stackexchange.com/questions/17278/calculate-lat-lon-bounds-for-individual-tile-generated-from-gdal2tiles
    function tile2long(x,z) { return (x/Math.pow(2,z)*360-180); }
    function tile2lat(y,z) {
        var n=Math.PI-2*Math.PI*y/Math.pow(2,z);
        return (180/Math.PI*Math.atan(0.5*(Math.exp(n)-Math.exp(-n))));
    }

    // leaflet-style URL hash pattern:
    // #[zoom],[lat],[lng]
    var url_hash = window.location.hash.slice(1).split('/');

    // location
    var defaultpos = true; // use default position

    // location is passed through url
    if (url_hash.length == 3) {
        var defaultpos = false;
        if (url_hash[1] > 180) { // parse hash as tile coordinates
            // example: http://localhost:9001/#15/5242/12663
            // add .5 to coords to center tile on screen
            map_start_location = [tile2lat(parseFloat(url_hash[2]) + .5, url_hash[0]), tile2long(parseFloat(url_hash[1]) + .5, url_hash[0]), url_hash[0]];
        }
        else { // parse hash as lat/lng coordinates
            map_start_location = [url_hash[1],url_hash[2], url_hash[0]];
            // convert from strings
            map_start_location = map_start_location.map(Number);
        }
    }

    // enable setting language by URL argument
    // eg: '?language=en&this=no'

    var query = splitQueryParams();
    // { language: 'en', this: 'no'}

    function splitQueryParams () {
       var str = window.location.search;

       var kvArray = str.slice(1).split('&');
       // ['language=en', 'this=no']

       var obj = {};

       for (var i = 0, j=kvArray.length; i<j; i++) {
           var value = kvArray[i].split('=');
           var k = window.decodeURIComponent(value[0]);
           var v = window.decodeURIComponent(value[1]);

           obj[k] = v;
       }

       return obj;
    }

    /*** Map ***/

    var map = L.map('map',
        {"keyboardZoomOffset" : .05, maxZoom: 20, "scrollWheelZoom": false }
    );
    map.setView(map_start_location.slice(0, 2), map_start_location[2]);

    var layer = Tangram.leafletLayer({
        scene: style_file,
        global: { sdk_api_key: 'vector-tiles-VyYjZGS' },
        attribution: '<a href="https://mapzen.com/tangram" target="_blank">Tangram</a> | &copy; OSM contributors | <a href="https://mapzen.com/" target="_blank">Mapzen</a>'
    });

    window.layer = layer;
    var scene = layer.scene;
    window.scene = scene;
    var latlng = {};
    var popup = document.getElementById('popup'); // click-popup

    // setView expects format ([lat, long], zoom)
    var hash = new L.Hash(map);

    function updateKey(value) {
        keytext = value;

        for (layer in scene.config.layers) {
            if (layer == "earth") continue;
            scene.config.layers[layer].properties.key_text = value;
        }
        scene.rebuildGeometry();
        scene.requestRedraw();
    }

    function updateValue(value) {
        valuetext = value;

        for (layer in scene.config.layers) {
            if (layer == "earth") continue;
            scene.config.layers[layer].properties.value_text = value;
        }
        scene.rebuildGeometry();
        scene.requestRedraw();
    }

    // Feature selection
    function initFeatureSelection () {
        map.getContainer().addEventListener('mousemove', function (event) {
            picking = true;
            latlng = map.mouseEventToLatLng(event);

            var pixel = { x: event.clientX, y: event.clientY };

            scene.getFeatureAt(pixel).then(function(selection) {
                if (!selection || selection.feature == null || selection.feature.properties == null) {
                    picking = false;
                    popup.style.visibility = 'hidden';
                    return;
                }
                var properties = selection.feature.properties;

                popup.style.width = 'auto';
                popup.style.left = (pixel.x + 0) + 'px';
                popup.style.top = (pixel.y + 0) + 'px';
                popup.style.margin = '10px';
                if (properties.name) {
                    popup.innerHTML = '<span class="labelInner">' + properties.name + '</span><br>';
                } else {
                    popup.innerHTML = '<span class="labelInner">' + 'unnamed ' + properties.kind + '</span><br>';
                }
                popup.innerHTML += '<span class="labelInner" style="font-size:10px;">' + 'Click to view more...' + '</span><br>';
                popup.style.visibility = 'visible';
            });
        });
    }

    function createEditLinkElement (url, type, label) {
        var el = document.createElement('div');
        var anchor = document.createElement('a');
        el.className = 'labelInner';
        anchor.href = url;
        anchor.target = '_blank';
        anchor.textContent = label;
        anchor.addEventListener('click', function (event) {
            trackOutboundLink(url, 'mapzen_carto_debug', type);
        }, false);
        el.appendChild(anchor);
        return el;
    }

    /**
    * Function that tracks a click on an outbound link in Google Analytics.
    * This function takes a valid URL string as an argument, and uses that URL string
    * as the event label. Setting the transport method to 'beacon' lets the hit be sent
    * using 'navigator.sendBeacon' in browser that support it.
    */
    function trackOutboundLink (url, post_name, editor) {
       // ga('send', 'event', [eventCategory], [eventAction], [eventLabel], [eventValue], [fieldsObject]);
       ga('send', 'event', 'outbound', post_name, url, {
         'transport': 'beacon',
         // If opening a link in the current window, this opens the url AFTER
         // registering the hit with Analytics. Disabled because here want the
         // link to open in a new window, so this hit can occur in the current tab.
         //'hitCallback': function(){document.location = url;}
       });
    }

    function long2tile(lon,zoom) { return (Math.floor((lon+180)/360*Math.pow(2,zoom))); }
    function lat2tile(lat,zoom)  { return (Math.floor((1-Math.log(Math.tan(lat*Math.PI/180) + 1/Math.cos(lat*Math.PI/180))/Math.PI)/2 *Math.pow(2,zoom))); }

    function mapzenTileURL() {
        // find minimum max_zoom of all sources
        var max_zoom = 21;
        for (source in scene.config.sources) {
            if (scene.config.sources.hasOwnProperty(source)) {
                if (scene.config.sources[source].max_zoom != "undefined") {
                    max_zoom = Math.min(max_zoom, scene.config.sources[source].max_zoom);
                }
            }
        }
        var zoom = max_zoom < map.getZoom() ? max_zoom : Math.floor(map.getZoom());
        var tileCoords = { x : long2tile(latlng.lng,zoom), y: lat2tile(latlng.lat,zoom), z: zoom };

        var url = 'http://tile.mapzen.com/mapzen/vector/v1/all/' + zoom + '/' + tileCoords.x  + '/' + tileCoords.y + '.topojson?api_key=vector-tiles-HqUVidw';
        return url;
    }

    /***** Render loop *****/

    // Create dat GUI
    var gui = new dat.GUI({ autoPlace: true, width: 250 });

    function addGUI() {
        gui.domElement.parentNode.style.zIndex = 10000;
        window.gui = gui;

        // Language selector
        var langs = {
            '(default)': false,
            'English': 'en',
            'Russian': 'ru',
            'Chinese': 'zh',
            'Japanese': 'ja',
            'Korean': 'ko',
            'Vietnamese': 'vi',
            'German': 'de',
            'French': 'fr',
            'Arabic': 'ar',
            'Spanish': 'es',
            'Italian': 'it',
            'Greek': 'el'
        };
        // use query language, else default to English
        gui.language = query.language || false;
        gui.add(gui, 'language', langs).onChange(function(value) {
            scene.config.global.ux_language = value;
            scene.updateConfig();
            //window.location.search = 'language=' + value;
        });
        gui.fallback_lang = query.language || false;
        gui.add(gui, 'fallback_lang', langs).onChange(function(value) {
            scene.config.global.ux_language_fallback = value;
            scene.updateConfig();
            //window.location.search = 'language=' + value;
        });

        // Transit selector
        var transit_overlay = {
            '(default)': false,
            'Show': true,
            'Hide': false
        };
        // use transit ux, else default to false
        gui.transit_overlay = query.transit_overlay || false;
        gui.add(gui, 'transit_overlay', transit_overlay).onChange(function(value) {
            scene.config.global.sdk_transit_overlay = (value === 'true' || value === true); // dat.gui passes a string
            scene.updateConfig();
        });
//
//         // Building extrusion selector
//         var building_3d = {
//             '(default)': true,
//             'Yes': true,
//             'No': false
//         };
//         // use transit ux, else default to false
//         gui.building_3d = query.building_3d || true;
//         gui.add(gui, 'building_3d', building_3d).onChange(function(value) {
//             scene.config.global.building_extrude = (value === 'true' || value === true); // dat.gui passes a string
//             scene.updateConfig();
//         });
//
        // Take a screenshot and save to file
        gui.save_screenshot = function () {
            return scene.screenshot().then(function(screenshot) {
                // uses FileSaver.js: https://github.com/eligrey/FileSaver.js/
                timestamp = new Date();
                month = timestamp.getMonth()+1;
                if( month < 10 ) { month = '0' + month; }
                prettydate = timestamp.getFullYear() + month + timestamp.getDate() + timestamp.getHours() + timestamp.getMinutes();
                map_location = map.getZoom() + '-' + map.getCenter().lat.toFixed(5) + '-' + map.getCenter().lng.toFixed(5);
                saveAs(screenshot.blob, 'tangram-' + map_location + '-' + prettydate + '.png');
            });
        };
        gui.add(gui, 'save_screenshot');

        // Enable/disable interactivity for all features
        var interactive_label = 'debug_interactive';
        gui[interactive_label] = false;
        gui.add(gui, interactive_label).onChange(function(value) {
            scene.setIntrospection(value);
        });
        scene.setIntrospection(gui[interactive_label]);

        // Link to edit in OSM - hold 'e' and click
        map.getContainer().addEventListener('dblclick', function (event) {
            //console.log( 'dblclick was had' );
            if( timer ) { clearTimeout( timer ); timer = null; }
            popup.style.visibility = 'hidden';
        });

        var timer;

        map.getContainer().addEventListener('click', function (event) {
            //console.log( 'click was had' );
            if( timer ) { clearTimeout( timer ); timer = null; }
            timer = setTimeout( function(){
                picking = true;
                latlng = map.mouseEventToLatLng(event);
                var pixel = { x: event.clientX, y: event.clientY };

                if( key.cmd || key.alt ) {
                    window.open( mapzenTileURL(), '_blank' );
                } else {
                    var url = 'https://www.openstreetmap.org/edit?';
                    scene.getFeatureAt(pixel).then(function(selection) {
                        if (!selection || selection.feature == null || selection.feature.properties == null) {
                            picking = false;
                            popup.style.visibility = 'hidden';
                            return;
                        }
                        //console.log(selection.feature, selection.changed);
                        // enable iD to show properties sidebar for selected feature
                        osm_type = 'node';
                        osm_zoom = '19'
                        if( selection.feature.properties.sort_key ) {
                            osm_type = 'way';
                            osm_zoom = Math.max( 17, map.getZoom() );
                        }
                        osm_id = selection.feature.properties.id;
                        if( osm_id < 0 ) {
                            osm_type = 'relation'
                            osm_id = Math.abs( osm_id );
                            osm_zoom = Math.max( 16, map.getZoom() );
                        }
                        url += osm_type + '=' + osm_id;
                        // and position the map so it's at a similar zoom to Tangram
                        if (latlng) {
                            url += '#map=' + osm_zoom + '/' + latlng.lat + '/' + latlng.lng;
                        }

                        if( key.shift ) {
                            window.open(url, '_blank');
                        } else {
                            var properties = selection.feature.properties;

                            var label = '';
                            //console.log(properties);
                            for (var x in properties) {
                                var val = properties[x]
                                label += "<span class='labelLine' key="+x+" value="+val+"'>"+x+" : "+val+"</span><br>"
                            }

                            if (label != '') {
                                popup.style.left = (pixel.x) + 'px';
                                popup.style.top = (pixel.y) + 'px';
                                popup.style.margin = '0px';
                                popup.innerHTML = '<span class="labelInner">' + label + '</span>';
                            }

                            // JOSM editor link
                            var position = '19' + '/' + latlng.lat + '/' + latlng.lng;
                            var josmUrl = 'http://www.openstreetmap.org/edit?editor=remote#map='+position;

                            popup.appendChild(createEditLinkElement( url, 'iD', 'Edit with iD ➹') );
                            popup.appendChild(createEditLinkElement( mapzenTileURL(), 'rawTile', 'View tile data ➹') );
                            //popup.appendChild(createEditLinkElement( josmUrl, 'JOSM', 'Edit with JOSM ➹') );
                            popup.style.visibility = 'visible';
                        }
                    });
                }
                timer = null;
            }, 200 );
        });
    }

    function inIframe () {
        try {
            return window.self !== window.top;
        } catch (e) {
            return true;
        }
    }

    // Add map
    window.addEventListener('load', function () {
        // Scene initialized
        layer.on('init', function() {
            if (!inIframe()) {
                map.scrollWheelZoom.enable();
                addGUI();
                initFeatureSelection();
            }

            var camera = scene.config.cameras[scene.getActiveCamera()];
            // if a camera position is set in the scene file, use that
            if (defaultpos && typeof camera.position != "undefined") {
                map_start_location = [camera.position[1], camera.position[0], camera.position[2]]
            }
            map.setView([map_start_location[0], map_start_location[1]], map_start_location[2]);
        });

        // Set initial language on scene load
        layer.scene.subscribe({
            load: function (msg) {
                msg.config.global.ux_language = query.language;
            }
        });

        layer.addTo(map);
    });

    return map;
}());
