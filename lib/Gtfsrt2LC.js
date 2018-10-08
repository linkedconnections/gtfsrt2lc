const { Readable } = require('stream');
const url = require('url');
const http = require('follow-redirects').http;
const https = require('follow-redirects').https;
const fs = require('fs');
const zlib = require('zlib');
const gtfsrt = require('gtfs-realtime-bindings');
const moment = require('moment-timezone');
const uri_templates = require('uri-templates');
const jsonldstream = require('jsonld-stream');
const N3 = require('n3');
const Connections2JSONLD = require('./Connections2JSONLD');
const Connections2CSV = require('./Connections2CSV');
const Connections2Triples = require('./Connections2Triples');

class Gtfsrt2LC {
    constructor(path, routes, trips, uris) {
        this._path = path;
        this._routes = routes;
        this._trips = trips;
        this._uris = uris;
    }

    async parse(format, object) {
        const readable = new Readable({
            objectMode: true,
            read() { }
        });

        try {
            let rawData = await this.getRawData();
            let feed = gtfsrt.FeedMessage.decode(rawData);

            Promise.all(feed.entity.map(async entity => {
                if (entity.trip_update) {
                    let trip_update = entity.trip_update;
                    let trip_id = trip_update.trip.trip_id;

                    // Check if there is static data about the update, skip if not
                    if (!this.trips.get(trip_id)) {
                        console.error('Trip id ' + trip_id + ' not found in current GTFS static data');
                        return;
                    }

                    // Check if train is canceled or not
                    let type = this.getConnectionType(entity);

                    // for each stop time update
                    let stop_times = trip_update.stop_time_update;
                    let st_length = stop_times.length;

                    for (let j = 0; j < st_length; j++) {
                        try {
                            if (j + 1 < st_length) {
                                // Basic attributes of a Connection
                                let departureStop = stop_times[j].stop_id.split(':')[0];
                                let arrivalStop = trip_update.stop_time_update[j + 1].stop_id.split(':')[0];
                                let departureTime = null;
                                let arrivalTime = null;
                                let departureDelay = 0;
                                let arrivalDelay = 0;

                                // Calculate departureTime including delay
                                if (stop_times[j].departure && stop_times[j].departure.time && stop_times[j].departure.time.low) {
                                    departureTime = moment(stop_times[j].departure.time.low * 1000);
                                }

                                // Calculate arrivalTime including delay
                                if (stop_times[j + 1].arrival && stop_times[j + 1].arrival.time && stop_times[j + 1].arrival.time.low) {
                                    arrivalTime = moment(stop_times[j + 1].arrival.time.low * 1000);
                                }

                                // depertureDelay value
                                if (stop_times[j].departure && stop_times[j].departure.delay) {
                                    departureDelay = stop_times[j].departure.delay;
                                }

                                // arrivalDelay value
                                if (stop_times[j + 1].arrival && stop_times[j + 1].arrival.delay) {
                                    arrivalDelay = stop_times[j + 1].arrival.delay;
                                }

                                let raw_connection = {
                                    departureStop: departureStop,
                                    departureTime: departureTime,
                                    arrivalStop: arrivalStop,
                                    arrivalTime: arrivalTime
                                };

                                //Predefined URI templates 
                                let stopTemplate = uri_templates(this.uris['stop']);
                                let routeTemplate = uri_templates(this.uris['route']);
                                let tripTemplate = uri_templates(this.uris['trip']);
                                let connectionTemplate = uri_templates(this.uris['connection']);

                                // Resolve values for URIs
                                let departureStopURI = stopTemplate.fill({ [stopTemplate.varNames[0]]: departureStop });
                                let arrivalStopURI = stopTemplate.fill({ [stopTemplate.varNames[0]]: arrivalStop });
                                let routeURI = this.resolveURI(routeTemplate, trip_id, raw_connection);
                                let tripURI = this.resolveURI(tripTemplate, trip_id, raw_connection);
                                let connectionURI = this.resolveURI(connectionTemplate, trip_id, raw_connection);

                                let linked_connection = {
                                    "@id": connectionURI,
                                    "@type": type,
                                    "departureStop": departureStopURI,
                                    "arrivalStop": arrivalStopURI,
                                    "departureTime": departureTime.toISOString(),
                                    "arrivalTime": arrivalTime.toISOString(),
                                    "departureDelay": departureDelay,
                                    "arrivalDelay": arrivalDelay,
                                    "direction": this.trips.get(trip_id).trip_headsign,
                                    "trip": tripURI,
                                    "route": routeURI
                                }

                                readable.push(linked_connection);
                            }
                        } catch (err) {
                            console.error('Null value found in stop times sequence for Trip ' + trip_id);
                            continue;
                        }
                    }
                }
            })).then(() => {
                readable.push(null);
            }).catch(err => {
                console.error(err);
                readable.push(null);
            });
        } catch (err) {
            console.error(err);
            readable.push(null);
        }

        // Serialize data according to specified format (default: json) 
        if (format === 'jsonld') {
            if (!object) {
                return readable.pipe(new Connections2JSONLD()).pipe(new jsonldstream.Serializer());
            } else {
                return readable.pipe(new Connections2JSONLD());
            }
        } else if (format === 'csv') {
            return readable.pipe(new Connections2CSV());
        } else if (format === 'ntriples') {
            return readable.pipe(new Connections2Triples()).pipe(new N3.StreamWriter({ format: 'N-Triples' }));
        } else if (format === 'turtle') {
            return readable.pipe(new Connections2Triples()).pipe(new N3.StreamWriter({
                prefixes: {
                    xsd: 'http://www.w3.org/2001/XMLSchema#',
                    lc: 'http://semweb.mmlab.be/ns/linkedconnections#',
                    gtfs: 'http://vocab.gtfs.org/terms#'
                }
            }));
        } else {
            if(!object) {
                return readable.pipe(new jsonldstream.Serializer());
            } else {
                return readable;
            }
        }
    } 

    getRawData() {
        return new Promise((rsv, rjt) => {
            // Download/access static GTFS feed
            if (this.path.startsWith('http') || this.path.startsWith('https')) {
                let download_url = url.parse(this.path);
                if (!download_url) {
                    reject('Please provide a valid url or a path to a GTFS-RT feed');
                } else {
                    if (download_url.protocol === 'https:') {
                        let req = https.request(download_url, res => this.handleResponse(res, rsv, rjt));
                        req.on('error', err => {
                            rjt(err);
                        });
                        req.end();
                    } else {
                        let req = http.request(download_url, res => this.handleResponse(res, rsv, rjt));
                        req.on('error', err => {
                            rjt(err);
                        });
                        req.end();
                    }
                }
            } else {
                if (!fs.existsSync(this.path)) {
                    rjt('Please provide a valid url or a path to a GTFS-RT feed');
                } else {
                    fs.readFile(this.path, (err, data) => {
                        if (err) rjt(err);
                        rsv(data);
                    });
                }
            }
        });
    }

    handleResponse(res, rsv, rjt) {
        let encoding = res.headers['content-encoding']
        let responseStream = res;
        let buffer = false;

        if (encoding && encoding == 'gzip') {
            responseStream = res.pipe(zlib.createGunzip());
        } else if (encoding && encoding == 'deflate') {
            responseStream = res.pipe(zlib.createInflate())
        }

        responseStream.on('data', chunk => {
            if (!buffer) {
                buffer = chunk;
            } else {
                buffer = Buffer.concat([buffer, chunk], buffer.length + chunk.length);
            }
        }).on('error', err => {
            rjt(err);
        }).on('end', () => {
            rsv(buffer);
        });
    }

    getConnectionType(entity) {
        if (entity.is_deleted) {
            return 'CanceledConnection';
        }
        else {
            return 'Connection';
        }
    }

    resolveURI(template, tripId, connectionParams) {
        let varNames = template.varNames;
        let fillerObj = {};

        for (let i in varNames) {
            fillerObj[varNames[i]] = this.resolveValue(varNames[i], tripId, connectionParams);
        }

        return template.fill(fillerObj);
    }

    resolveValue(param, tripId, connParams) {
        // GTFS source file and attribute name
        let source = param.split('.')[0];
        let attr = param.split('.')[1];

        // Entity objects to be resolved as needed
        let trip = null;
        let route = null;
        let caldate = null;

        let value = null;

        switch (source) {
            case 'trips':
                trip = this.trips.get(tripId);
                value = trip[attr];
                break;
            case 'routes':
                trip = this.trips.get(tripId);
                route = this.routes.get(trip.route_id);
                value = route[attr];
                break;
            case 'connection':
                if (attr.indexOf('departureTime') >= 0) {
                    let format = attr.match(/\((.*?)\)/)[1];
                    value = connParams.departureTime.format(format);
                } else if (attr.indexOf('arrivalTime') >= 0) {
                    let format = attr.match(/\((.*?)\)/)[1];
                    value = connParams.arrivalTime.format(format);
                } else {
                    value = connParams[attr];
                }
                break;
        }

        return value;
    }

    get path() {
        return this._path;
    }

    get routes() {
        return this._routes;
    }

    get trips() {
        return this._trips;
    }

    get uris() {
        return this._uris;
    }
}

module.exports = Gtfsrt2LC;