const url = require('url');
const util = require('util');
const fs = require('fs');
const unzip = require('unzipper');
const csv = require('fast-csv');
const del = require('del');
const http = require('follow-redirects').http;
const https = require('follow-redirects').https;
const childProcess = require('child_process');
const level = require('level');

const exec = util.promisify(childProcess.exec);

class GtfsIndex {
    constructor(options) {
        this._path = options.path;
        this._auxPath = options.auxPath || '.tmp';
        this._headers = options.headers || {};
    }

    getIndexes(options) {
        return new Promise(async (resolve, reject) => {
            try {
                await this.cleanUp();
                // Download/access static GTFS feed
                if (this.path.startsWith('http') || this.path.startsWith('https')) {
                    let download_url = url.parse(this.path);
                    if (!download_url) {
                        reject('Please provide a valid url or a path to a GTFS feed');
                        return;
                    } else {
                        download_url.headers = this.headers;
                        await this.doRequest(download_url);
                    }
                } else {
                    if (!fs.existsSync(this.path)) {
                        reject('Please provide a valid url or a path to a GTFS feed');
                        return;
                    } else {
                        await this.unzip(fs.createReadStream(this.path));
                    }
                }

                resolve(this.createIndexes(options.store, options.trips));
            } catch (err) {
                await this.cleanUp();
                reject(err);
            }
        });
    }

    doRequest(url) {
        return new Promise((resolve, reject) => {
            let req = null;
            if (url.protocol === 'https:') {
                req = https.request(url, async res => {
                    await this.unzip(res)
                    resolve();
                });
            } else {
                req = http.request(url, async res => {
                    await this.unzip(res)
                    resolve();
                });
            }
            req.on('error', err => {
                reject(err);
            });
            req.end();
        });
    }

    unzip(res) {
        return new Promise((resolve, reject) => {
            if(!fs.existsSync(this.auxPath)) {
                fs.mkdirSync(this.auxPath);
            }
            res.pipe(unzip.Extract({ path: this.auxPath }))
                .on('error', async err => {
                    await this.cleanUp();
                    reject(err);
                })
                .on('close', () => {
                    resolve();
                });
        });
    }

    async createIndexes(store, uTrips) {
        let stops_index = null;
        let routes_index = null;
        let trips_index = null;
        let stop_times_index = null;

        let stops = null;
        let routes = null;
        let trips = null;
        let stop_times = null;

        // CSV headers of stop_times.txt. Needed for grep and sort processes.
        let stopTimesHeaders = await this.getGtfsHeaders('stop_times.txt');

        if (store === 'MemStore') {
            stops_index = new Map();
            routes_index = new Map();
            trips_index = new Map();
            stop_times_index = new Map();

            if (uTrips) {
                console.error(`Using grep to extract the stop_times of ${uTrips.length} trips`);
                // Only load the necessary trips and stop_times
                let tripsHeaders = await this.getGtfsHeaders('trips.txt');
                trips = Promise.all(uTrips.map(async trip => {
                    let t = await this.grepGtfsFile(trip, 'trips.txt', tripsHeaders);
                    trips_index.set(trip, t[0]);
                }));

                // Grep the stop_times of only the trips present in the GTFS-RT update
                stop_times = this.grepStopTimes(uTrips, stopTimesHeaders, stop_times_index);

            } else {
                trips = this.createIndex(this.auxPath + '/trips.txt', trips_index, 'trip_id');
                // Make sure stop_times.txt is ordered by stop_sequence
                let ti_index = stopTimesHeaders.indexOf('trip_id') + 1;
                let ss_index = stopTimesHeaders.indexOf('stop_sequence') + 1;
                await this.sortStopTimes(ti_index, ss_index);
                // Create index of stop times for every trip
                stop_times = this.processStopTimes(this.auxPath + '/stop_times.txt', stop_times_index);
            }
        } else if (store === 'LevelStore') {
            await del([ '.rt_indexes' ], { force: true });
            fs.mkdirSync('.rt_indexes');

            stops_index = level('.rt_indexes/.stops');
            routes_index = level('.rt_indexes/.routes');
            trips_index = level('.rt_indexes/.trips');
            stop_times_index = level('.rt_indexes/.stop_times');

            trips = this.createIndex(this.auxPath + '/trips.txt', trips_index, 'trip_id');
            // Make sure stop_times.txt is ordered by stop_sequence
            let ti_index = stopTimesHeaders.indexOf('trip_id') + 1;
            let ss_index = stopTimesHeaders.indexOf('stop_sequence') + 1;
            await this.sortStopTimes(ti_index, ss_index);
            console.error('Sorted stop_times.txt by trip_id and stop_sequence');
            stop_times = this.processStopTimes(this.auxPath + '/stop_times.txt', stop_times_index);
        } else {
            throw new Error(`Unrecognized store format: ${store}`);
        }

        stops = this.createIndex(this.auxPath + '/stops.txt', stops_index, 'stop_id');
        routes = this.createIndex(this.auxPath + '/routes.txt', routes_index, 'route_id');

        await Promise.all([stops, routes, trips, stop_times]);
        await this.cleanUp();

        return {
            "routes": routes_index,
            "trips": trips_index,
            "stops": stops_index,
            "stop_times": stop_times_index
        };
    }

    async createIndex(path, map, key) {
        let stream = fs.createReadStream(path, { encoding: 'utf8', objectMode: true })
            .pipe(csv.parse({ objectMode: true, headers: true }))
            .on('error', err => { throw err; });

        for await (const data of stream) {
            if (data[key]) {
                if (map instanceof Map) {
                    map.set(data[key], data);
                } else {
                    await map.put(data[key], data, { valueEncoding: 'json' });
                }
            }
        }
    }

    async getGtfsHeaders(fileName) {
        return (await exec('head -1 ' + fileName, { cwd: this.auxPath }))['stdout'].replace(/[\n\r"]/g, "").split(',');
    }

    async sortStopTimes(ti_index, ss_index) {
        return exec('{ head -n 1 stop_times.txt ; tail -n +2 stop_times.txt | sort -t , -k '
            + ti_index + 'd,' + ti_index + ' -k' + ss_index + 'n,' + ss_index + '; } '
            + '> stop_times_sorted.txt ; mv stop_times_sorted.txt stop_times.txt ;', { cwd: this.auxPath });
    }

    async processStopTimes(path, map) {
        let currentTripId = null;
        let currentTrip = [];

        let stream = fs.createReadStream(path, { encoding: 'utf8', objectMode: true })
            .pipe(csv.parse({ objectMode: true, headers: true }))
            .on('error', err => { throw err });

        for await (const data of stream) {
            if (data['trip_id']) {
                if (currentTripId === null || data['trip_id'] === currentTripId) {
                    currentTrip.push(data);
                } else {
                    // Add to the index
                    if (map instanceof Map) {
                        map.set(currentTripId, currentTrip);
                    } else {
                        await map.put(currentTripId, currentTrip, { valueEncoding: 'json' });
                    }
                    // Prepare for next trip
                    currentTrip = [];
                    currentTrip.push(data);
                }

                // Keep track of the current trip
                currentTripId = data['trip_id'];
            }
        }
    }

    grepStopTimes(trips, stopTimesHeaders, stop_times_index) {
        return Promise.all(trips.map(async trip => {
            let stopTimes = await this.grepGtfsFile(trip, 'stop_times.txt', stopTimesHeaders);
            // Sort by stop_sequence to ensure an ordered stop list
            stopTimes.sort((a, b) => {
                return parseInt(a['stop_sequence']) - parseInt(b['stop_sequence']);
            });
            stop_times_index.set(trip, stopTimes);
        }));
    }

    grepGtfsFile(tripId, fileName, headers) {
        return new Promise((resolve, reject) => {
            let buffer = '';
            let grep = childProcess.spawn('grep', [tripId, fileName], { cwd: this.auxPath });

            grep.stdout.on('data', data => {
                buffer += data.toString();
            });

            grep.stderr.on('data', (data) => {
                console.error(`stderr: ${data}`);
                reject();
            });

            grep.on('close', () => {
                let result = [];
                let dataArray = buffer.split('\n');
                // Get rid of the last empty string
                dataArray.pop();

                for (let i in dataArray) {
                    let obj = {};
                    let d = dataArray[i].replace(/[\n\r"]/g, "").split(',');
                    for (let j in headers) {
                        obj[headers[j]] = d[j];
                    }
                    result.push(obj);
                }

                resolve(result);
            });
        });
    }

    async cleanUp() {
        await del([this.auxPath], { force: true });
    }

    get path() {
        return this._path;
    }

    get auxPath() {
        return this._auxPath;
    }

    get headers() {
        return this._headers;
    }
}

module.exports = GtfsIndex;
