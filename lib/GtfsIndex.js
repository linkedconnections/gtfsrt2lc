const url = require('url');
const fs = require('fs');
const unzip = require('unzipper');
const csv = require('fast-csv');
const del = require('del');
const http = require('follow-redirects').http;
const https = require('follow-redirects').https;

class GtfsIndex {
    constructor(path) {
        this._path = path;
    }

    getIndexes() {
        return new Promise(async (resolve, reject) => {
            await this.cleanUp();
            // Download/access static GTFS feed
            if (this.path.startsWith('http') || this.path.startsWith('https')) {
                let download_url = url.parse(this.path);
                if (!download_url) {
                    reject('Please provide a valid url or a path to a GTFS feed');
                } else {
                    if (download_url.protocol === 'https:') {
                        let req = https.request(download_url, res => this.handleResponse(res, resolve, reject));
                        req.on('error', err => {
                            reject(err);
                        });
                        req.end();
                    } else {
                        let req = http.request(download_url, res => this.handleResponse(res, resolve, reject));
                        req.on('error', err => {
                            reject(err);
                        });
                        req.end();
                    }
                }
            } else {
                if (!fs.existsSync(this.path)) {
                    reject('Please provide a valid url or a path to a GTFS feed');
                } else {
                    fs.mkdirSync('.tmp');
                    fs.createReadStream(this.path).pipe(unzip.Extract({ path: '.tmp' }))
                        .on('error', async err => {
                            await this.cleanUp();
                            reject(err);
                        })
                        .on('close', () => {
                            this.extractIndexes(resolve, reject);
                        });
                }
            }
        });
    }

    handleResponse(res, resolve, reject) {
        fs.mkdirSync('.tmp');
        res.pipe(unzip.Extract({ path: '.tmp' }))
            .on('error', async err => {
                await this.cleanUp();
                reject(err);
            })
            .on('close', () => {
                this.extractIndexes(resolve, reject);
            });
    }

    extractIndexes(resolve, reject) {
        let routes_index = new Map();
        let trips_index = new Map();
        let stops_index = new Map();
        let stop_times_index = new Map();

        let count = 0;
        // Function to sync streams
        let finish = async () => {
            count++;
            if (count === 4) {
                // Delete temporal dir with unzipped GTFS files
                await this.cleanUp();
                resolve([routes_index, trips_index, stops_index, stop_times_index]);
            }
        };

        // Parse the GTFS files using fast-csv lib
        fs.createReadStream('.tmp/routes.txt', { encoding: 'utf8', objectMode: true })
            .pipe(csv({ objectMode: true, headers: true }))
            .on('data', route => {
                if (route['route_id']) {
                    routes_index.set(route['route_id'], route);
                }
            })
            .on('error', async err => {
                await this.cleanUp();
                reject(err);
            })
            .on('finish', finish);

        fs.createReadStream('.tmp/trips.txt', { encoding: 'utf8', objectMode: true })
            .pipe(csv({ objectMode: true, headers: true }))
            .on('data', trip => {
                if (trip['trip_id']) {
                    trips_index.set(trip['trip_id'], trip);
                }
            })
            .on('error', async err => {
                await this.cleanUp();
                reject(err);
            })
            .on('finish', finish);

        fs.createReadStream('.tmp/stops.txt', { encoding: 'utf8', objectMode: true })
            .pipe(csv({ objectMode: true, headers: true }))
            .on('data', stop => {
                if (stop['stop_id']) {
                    stops_index.set(stop['stop_id'], stop);
                }
            })
            .on('error', async err => {
                await this.cleanUp();
                reject(err);
            })
            .on('finish', finish);

        fs.createReadStream('.tmp/stop_times.txt', { encoding: 'utf8', objectMode: true })
            .pipe(csv({ objectMode: true, headers: true }))
            .on('data', stop_time => {
                if (stop_time['trip_id']) {
                    let entries = [];
                    if (stop_times_index.has(stop_time['trip_id'])) {
                        entries = stop_times_index.get(stop_time['trip_id'])
                        entries.push(stop_time);
                    }
                    else {
                        entries.push(stop_time);
                    }
                    stop_times_index.set(stop_time['trip_id'], entries);
                }
            })
            .on('error', async err => {
                await this.cleanUp();
                reject(err);
            })
            .on('finish', finish);
    }

    async cleanUp() {
        await del(['.tmp'], { force: true });
    }

    get path() {
        return this._path;
    }
}

module.exports = GtfsIndex;
