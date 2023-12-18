const { test, expect } = require('@jest/globals');
const del = require('del');
const { Readable } = require('stream');
const uri_templates = require('uri-templates');
const { Level } = require('level');
const GtfsIndex = require('../lib/GtfsIndex');
const Gtfsrt2lc = require('../lib/Gtfsrt2LC');
const Utils = require('../lib/Utils');

const static_path = './test/data/static_rawdata.zip';
const rt_path = './test/data/realtime_rawdata';

const mock_uris = {
    "stop": "http://irail.be/stations/NMBS/00{stops.stop_id}",
    "route": "http://irail.be/vehicle/{routes.route_id}",
    "trip": "http://irail.be/vehicle/{trips.trip_id}/{trips.startTime(yyyyMMdd'T'HHmm)}",
    "connection": "http://irail.be/connections/{headsign}/{connection.departureStop}/{trips.startTime(yyyyMMdd'T'HHmm)}",
    "resolve": {
        "headsign": "trips.trip_headsign.replace(/\\s/, '');"
    }
};

var updatedTrips = null;
var memIndexes = null
var grepIndexes = null
var levelIndexes = null
var grt = null;
var memConnections = [];
var grepConnections = [];
var levelConnections = [];


// Make sure test process does not crash due to timeouts
jest.setTimeout(180000);

test('Obtain the list of trips to be updated from GTFS-RT data', async () => {
    expect.assertions(2);
    grt = new Gtfsrt2lc({ path: rt_path, uris: mock_uris });
    updatedTrips = await grt.getUpdatedTrips();
    expect(updatedTrips).toBeDefined();
    expect(updatedTrips.length).toBeGreaterThan(0);
});

test('Extract all indexes from sample static GTFS data (test/data/static_rawdata.zip) using MemStore', async () => {
    let gti = new GtfsIndex({ path: static_path });
    expect.assertions(12);
    memIndexes = await gti.getIndexes({ store: 'MemStore' });

    expect(memIndexes.routes).toBeDefined();
    expect(memIndexes.trips).toBeDefined();
    expect(memIndexes.stops).toBeDefined();
    expect(memIndexes.stop_times).toBeDefined();
    expect(memIndexes.tripsByRoute).toBeDefined();
    expect(memIndexes.firstStops).toBeDefined();
    expect(memIndexes.calendar).toBeDefined();
    expect(memIndexes.calendarDates).toBeDefined();

    expect(memIndexes.routes.size).toBeGreaterThan(0);
    expect(memIndexes.trips.size).toBeGreaterThan(0);
    expect(memIndexes.stops.size).toBeGreaterThan(0);
    expect(memIndexes.stop_times.size).toBeGreaterThan(0);
});

test('Extract all indexes from sample static GTFS data (test/data/static_rawdata.zip) using MemStore and grep', async () => {
    let gti = new GtfsIndex({ path: static_path });
    expect.assertions(8);
    grepIndexes = await gti.getIndexes({ store: 'MemStore', trips: updatedTrips });

    let grepRoutes = grepIndexes.routes;
    let grepTrips = grepIndexes.trips;
    let grepStops = grepIndexes.stops;
    let grepStop_times = grepIndexes.stop_times;

    expect(grepRoutes).toBeDefined();
    expect(grepTrips).toBeDefined();
    expect(grepStops).toBeDefined();
    expect(grepStop_times).toBeDefined();

    expect(grepRoutes.size).toBeGreaterThan(0);
    expect(grepTrips.size).toBeGreaterThan(0);
    expect(grepStops.size).toBeGreaterThan(0);
    expect(grepStop_times.size).toBeGreaterThan(0);
});

test('Extract all indexes from sample static GTFS data (test/data/static_rawdata.zip) using LevelStore', async () => {
    const gti = new GtfsIndex({ path: static_path });
    expect.assertions(4);
    levelIndexes = await gti.getIndexes({ store: 'LevelStore' });

    let levelRoutes = levelIndexes.routes;
    let levelTrips = levelIndexes.trips;
    let levelStops = levelIndexes.stops;
    let levelStop_times = levelIndexes.stop_times;

    expect(levelRoutes).toBeDefined();
    expect(levelTrips).toBeDefined();
    expect(levelStops).toBeDefined();
    expect(levelStop_times).toBeDefined();
});

test('Extract all indexes when source is given as decompressed folder', async () => {
    // First decompress GTFS zip file
    const sourcePath = './test/data/decompressed';
    Utils.unzip(static_path, sourcePath);
    // Extract indexes
    expect.assertions(4);
    const gti = new GtfsIndex({ path: sourcePath });
    const indexes = await gti.getIndexes({ store: 'MemStore' });

    expect(indexes.routes).toBeDefined();
    expect(indexes.trips).toBeDefined();
    expect(indexes.stops).toBeDefined();
    expect(indexes.stop_times).toBeDefined();
    await del(['./test/data/decompressed'], { force: true });
});

test('Historic records are used to prune unchanged connections', async () => {
    expect.assertions(4);
    const historyDB = new Level('./test/data/history.db', { valueEncoding: 'json' });
    const gti = new GtfsIndex({ path: static_path });
    const indexes = await gti.getIndexes({ store: 'MemStore' });

    // First run
    const grt1 = new Gtfsrt2lc({ 
        path: rt_path,
        uris: mock_uris,
    });
    grt1.setIndexes({ ...indexes, historyDB });
    const connStream1 = await grt1.parse({ format: 'jsonld', objectMode: true });
    let count1 = 0;
    const endStream = new Promise(res => {
        connStream1.on('end', () => res(true))
            .on('error', () => res(false));
    });
    connStream1.on('data', conn => { count1++; });
    const success1 = await endStream;

    // Second run
    const grt2 = new Gtfsrt2lc({ 
        path: rt_path,
        uris: mock_uris,
    });
    grt2.setIndexes({ ...indexes, historyDB });
    const connStream2 = await grt2.parse({ format: 'jsonld', objectMode: true });
    let count2 = 0;
    const endStream2 = new Promise(res => {
        connStream2.on('end', () => res(true))
            .on('error', () => res(false));
    });
    connStream2.on('data', conn => { count2++; });
    const success2 = await endStream2;
    
    expect(success1).toBeTruthy();
    expect(count1).toBeGreaterThan(0);
    expect(success2).toBeTruthy();
    expect(count2).toBe(0);

    await del(['./test/data/history.db'], { force: true });
});

test('Check all parsed connections are consistent regarding departure and arrival times', async () => {
    grt.setIndexes(memIndexes);
    let connStream = await grt.parse({ format: 'jsonld' });
    let flag = true;
    expect.assertions(2);

    connStream.on('data', async conn => {
        let depTime = new Date(conn['departureTime']);
        let arrTime = new Date(conn['arrivalTime']);
        if (depTime > arrTime) {
            console.error('Inconsistent Connection: ' + conn['@id']);
            flag = false;
        }

        // Add JSON connections to global array to avoid parsing them on every test where they are needed
        memConnections.push(conn);
    });

    let stream_end = new Promise(resolve => {
        connStream.on('end', () => {
            resolve(true);
        });
        connStream.on('error', () => {
            resolve(false);
        });
    });

    let finish = await stream_end;

    expect(flag).toBeTruthy();
    expect(finish).toBeTruthy();
});

test('Check all parsed connections are consistent regarding departure and arrival times using MemStore with grep', async () => {
    grt.setIndexes(grepIndexes);
    let connStream = await grt.parse({ format: 'jsonld' });
    let flag = true;
    expect.assertions(2);

    connStream.on('data', async conn => {
        let depTime = new Date(conn['departureTime']);
        let arrTime = new Date(conn['arrivalTime']);
        if (depTime > arrTime) {
            console.error('Inconsistent Connection: ' + conn['@id']);
            flag = false;
        }

        // Add JSON connections to global array to avoid parsing them on every test where they are needed
        grepConnections.push(conn);
    });

    let stream_end = new Promise(resolve => {
        connStream.on('end', () => {
            resolve(true);
        });
        connStream.on('error', () => {
            resolve(false);
        });
    });

    let finish = await stream_end;

    expect(flag).toBeTruthy();
    expect(finish).toBeTruthy();
});

test('Check all parsed connections are consistent regarding departure and arrival times using LevelStore', async () => {
    grt.setIndexes(levelIndexes);
    let connStream = await grt.parse({ format: 'jsonld' });
    let flag = true;
    expect.assertions(2);

    connStream.on('data', async conn => {
        let depTime = new Date(conn['departureTime']);
        let arrTime = new Date(conn['arrivalTime']);
        if (depTime > arrTime) {
            console.error('Inconsistent Connection: ' + conn['@id']);
            flag = false;
        }

        // Add JSON connections to global array to avoid parsing them on every test where they are needed
        levelConnections.push(conn);
    });

    let stream_end = new Promise(resolve => {
        connStream.on('end', () => {
            resolve(true);
        });
        connStream.on('error', () => {
            resolve(false);
        });
    });

    let finish = await stream_end;

    expect(flag).toBeTruthy();
    expect(finish).toBeTruthy();

    // Close Level dbs so they can be opened in further tests
    await levelIndexes.routes.close();
    await levelIndexes.trips.close();
    await levelIndexes.stops.close();
    await levelIndexes.stop_times.close();
    await levelIndexes.calendar.close();
});

test('Parse real-time update (test/data/realtime_rawdata) and give it back in jsonld format (no objectMode)', async () => {
    grt.setIndexes(memIndexes);
    let rt_stream = await grt.parse({ format: 'jsonld' });
    let buffer = [];

    expect.assertions(2);

    rt_stream.on('data', async data => {
        buffer.push(data);
    });

    let stream_end = new Promise(resolve => {
        rt_stream.on('end', () => {
            resolve(true);
        });
        rt_stream.on('error', () => {
            resolve(false);
        });
    });

    let finish = await stream_end;

    expect(buffer.length).toBeGreaterThan(0);
    expect(finish).toBeTruthy();
});

test('Parse real-time update (test/data/realtime_rawdata) and give it back in jsonld format (objectMode)', async () => {
    grt.setIndexes(memIndexes);
    let rt_stream = await grt.parse({ format: 'jsonld', objectMode: true });
    let buffer = [];

    expect.assertions(2);

    rt_stream.on('data', async data => {
        buffer.push(data);
    });

    let stream_end = new Promise(resolve => {
        rt_stream.on('end', () => {
            resolve(true);
        });
        rt_stream.on('error', () => {
            resolve(false);
        });
    });

    let finish = await stream_end;

    expect(buffer.length).toBeGreaterThan(0);
    expect(finish).toBeTruthy();
});

test('Parse real-time update (test/data/realtime_rawdata) and give it back in csv format', async () => {
    let rt_stream = await grt.parse({ format: 'csv' });
    let buffer = [];

    expect.assertions(2);

    rt_stream.on('data', data => {
        buffer.push(data);
    });

    let stream_end = new Promise(resolve => {
        rt_stream.on('end', () => {
            resolve(true);
        });
        rt_stream.on('error', () => {
            resolve(false);
        });
    });

    let finish = await stream_end;

    expect(buffer.length).toBeGreaterThan(0);
    expect(finish).toBeTruthy();
});

test('Parse real-time update (test/data/realtime_rawdata) and give it back in turtle format', async () => {
    let rt_stream = await grt.parse({ format: 'turtle' });
    let buffer = [];

    expect.assertions(2);

    rt_stream.on('data', async data => {
        buffer.push(data);
    });

    let stream_end = new Promise(resolve => {
        rt_stream.on('end', () => {
            resolve(true);
        });
        rt_stream.on('error', () => {
            resolve(false);
        });
    });

    let finish = await stream_end;

    expect(buffer.length).toBeGreaterThan(0);
    expect(finish).toBeTruthy();
});

test('Parse real-time update (test/data/realtime_rawdata) and give it back in ntriples format', async () => {
    let rt_stream = await grt.parse({ format: 'ntriples' });
    let buffer = [];

    expect.assertions(2);

    rt_stream.on('data', async data => {
        buffer.push(data);
    });

    let stream_end = new Promise(resolve => {
        rt_stream.on('end', () => {
            resolve(true);
        });
        rt_stream.on('error', () => {
            resolve(false);
        });
    });

    let finish = await stream_end;

    expect(buffer.length).toBeGreaterThan(0);
    expect(finish).toBeTruthy();
});

test('Stop gaps introduced by the GTFS-RT updates wrt the static schedule are filled correctly with MemStore', () => {
    expect.assertions(3);
    // Trip 88____:007::8893120:8821006:13:923:20191214:1 => First 3 stop updates are matched in schedule (13 in total)
    // Trip 88____:007::8841608:8841004:4:850:20191214 => Second and third stop updates are matched in schedule (4 in total)
    // Trip 88____:007::8819406:8881166:19:834:20190316 => Third and fifth stop updates are matched in schedule (19 in total)

    let testConnections = {
        '88____:007::8893120:8821006:13:923:20191214:1': [],
        '88____:007::8841608:8841004:4:850:20191214': [],
        '88____:007::8819406:8881166:19:834:20190316': []
    };

    for (let i in memConnections) {
        if (memConnections[i].indexOf(encodeURIComponent('88____:007::8893120:8821006:13:923:20191214:1')) >= 0) {
            testConnections['88____:007::8893120:8821006:13:923:20191214:1'].push(JSON.parse(memConnections[i]));
        }

        if (memConnections[i].indexOf(encodeURIComponent('88____:007::8841608:8841004:4:850:20191214')) >= 0) {
            testConnections['88____:007::8841608:8841004:4:850:20191214'].push(JSON.parse(memConnections[i]));
        }

        if (memConnections[i].indexOf(encodeURIComponent('88____:007::8819406:8881166:19:834:20190316')) >= 0) {
            testConnections['88____:007::8819406:8881166:19:834:20190316'].push(JSON.parse(memConnections[i]));
        }
    }

    expect(testConnections['88____:007::8893120:8821006:13:923:20191214:1'].length).toBe(12);
    expect(testConnections['88____:007::8841608:8841004:4:850:20191214'].length).toBe(3);
    expect(testConnections['88____:007::8819406:8881166:19:834:20190316'].length).toBe(17);
});

test('Stop gaps introduced by the GTFS-RT updates wrt the static schedule are filled correctly with MemStore and grep', () => {
    expect.assertions(3);
    // Trip 88____:007::8893120:8821006:13:923:20191214:1 => First 3 stop updates are matched in schedule (13 in total)
    // Trip 88____:007::8841608:8841004:4:850:20191214 => Second and third stop updates are matched in schedule (4 in total)
    // Trip 88____:007::8819406:8881166:19:834:20190316 => Third and fifth stop updates are matched in schedule (19 in total)

    let testConnections = {
        '88____:007::8893120:8821006:13:923:20191214:1': [],
        '88____:007::8841608:8841004:4:850:20191214': [],
        '88____:007::8819406:8881166:19:834:20190316': []
    };

    for (let i in grepConnections) {
        if (grepConnections[i].indexOf(encodeURIComponent('88____:007::8893120:8821006:13:923:20191214:1')) >= 0) {
            testConnections['88____:007::8893120:8821006:13:923:20191214:1'].push(JSON.parse(grepConnections[i]));
        }

        if (grepConnections[i].indexOf(encodeURIComponent('88____:007::8841608:8841004:4:850:20191214')) >= 0) {
            testConnections['88____:007::8841608:8841004:4:850:20191214'].push(JSON.parse(grepConnections[i]));
        }

        if (grepConnections[i].indexOf(encodeURIComponent('88____:007::8819406:8881166:19:834:20190316')) >= 0) {
            testConnections['88____:007::8819406:8881166:19:834:20190316'].push(JSON.parse(grepConnections[i]));
        }
    }

    expect(testConnections['88____:007::8893120:8821006:13:923:20191214:1'].length).toBe(12);
    expect(testConnections['88____:007::8841608:8841004:4:850:20191214'].length).toBe(3);
    expect(testConnections['88____:007::8819406:8881166:19:834:20190316'].length).toBe(17);
});

test('Stop gaps introduced by the GTFS-RT updates wrt the static schedule are filled correctly with LevelStore', () => {
    expect.assertions(3);
    // Trip 88____:007::8893120:8821006:13:923:20191214:1 => First 3 stop updates are matched in schedule (13 in total)
    // Trip 88____:007::8841608:8841004:4:850:20191214 => Second and third stop updates are matched in schedule (4 in total)
    // Trip 88____:007::8819406:8881166:19:834:20190316 => Third and fifth stop updates are matched in schedule (19 in total)

    let testConnections = {
        '88____:007::8893120:8821006:13:923:20191214:1': [],
        '88____:007::8841608:8841004:4:850:20191214': [],
        '88____:007::8819406:8881166:19:834:20190316': []
    };

    for (let i in levelConnections) {
        if (levelConnections[i].indexOf(encodeURIComponent('88____:007::8893120:8821006:13:923:20191214:1')) >= 0) {
            testConnections['88____:007::8893120:8821006:13:923:20191214:1'].push(JSON.parse(levelConnections[i]));
        }

        if (levelConnections[i].indexOf(encodeURIComponent('88____:007::8841608:8841004:4:850:20191214')) >= 0) {
            testConnections['88____:007::8841608:8841004:4:850:20191214'].push(JSON.parse(levelConnections[i]));
        }

        if (levelConnections[i].indexOf(encodeURIComponent('88____:007::8819406:8881166:19:834:20190316')) >= 0) {
            testConnections['88____:007::8819406:8881166:19:834:20190316'].push(JSON.parse(levelConnections[i]));
        }
    }

    expect(testConnections['88____:007::8893120:8821006:13:923:20191214:1'].length).toBe(12);
    expect(testConnections['88____:007::8841608:8841004:4:850:20191214'].length).toBe(3);
    expect(testConnections['88____:007::8819406:8881166:19:834:20190316'].length).toBe(17);
});

test('Check cancelled vehicle detection and related Connections (use test/data/cancellation_realtime_rawdata) with MemStore', async () => {
    grt = new Gtfsrt2lc({ path: './test/data/cancellation_realtime_rawdata', uris: mock_uris });
    let gti = new GtfsIndex({ path: './test/data/cancellation_static_rawdata.zip' });
    const indexes = await gti.getIndexes({ store: 'MemStore' });
    grt.setIndexes(indexes);

    let connStream = await grt.parse({ format: 'turtle', objectMode: true });
    let cancelledConnections = [];

    expect.assertions(2);

    connStream.on('data', conn => {
        if (conn.indexOf('lc:CancelledConnection') >= 0) {
            cancelledConnections.push(conn);
        }
    });

    let stream_end = new Promise(resolve => {
        connStream.on('end', () => {
            resolve(true);
        });
        connStream.on('error', () => {
            resolve(false);
        });
    });

    let finished = await stream_end;
    expect(finished).toBeTruthy();
    expect(cancelledConnections.length).toBe(9);
});

test('Test processing of feed without trip start date and time (use test/data/bustang.pb) with MemStore', async () => {
    grt = new Gtfsrt2lc({ path: './test/data/bustang.pb', uris: mock_uris });
    let gti = new GtfsIndex({ path: './test/data/bustang.gtfs.zip' });
    const indexes = await gti.getIndexes({ store: 'MemStore' });
    grt.setIndexes(indexes);

    let connStream = await grt.parse({ format: 'turtle', objectMode: true });
    let connections = [];

    expect.assertions(2);

    connStream.on('data', conn => {
        connections.push(conn);
    });

    let stream_end = new Promise(resolve => {
        connStream.on('end', () => {
            resolve(true);
        });
        connStream.on('error', () => {
            resolve(false);
        });
    });

    let finished = await stream_end;
    expect(finished).toBeTruthy();
    expect(connections.length).toBe(365);
});

test('Test parsing a GTFS-RT v2.0 file (use test/data/realtime_rawdata_v2) with MemStore', async () => {
    grt = new Gtfsrt2lc({ path: './test/data/realtime_rawdata_v2', uris: mock_uris });
    let gti = new GtfsIndex({ path: './test/data/static_rawdata_v2.zip' });
    const indexes = await gti.getIndexes({ store: 'MemStore' });
    grt.setIndexes(indexes);

    let connStream = await grt.parse({ format: 'json', objectMode: true });
    let buffer = [];

    expect.assertions(2);

    connStream.on('data', async data => {
        buffer.push(data);
    });

    let stream_end = new Promise(resolve => {
        connStream.on('end', () => {
            resolve(true);
        });
        connStream.on('error', () => {
            resolve(false);
        });
    });

    let finish = await stream_end;

    expect(buffer.length).toBeGreaterThan(0);
    expect(finish).toBeTruthy();
});

test('Test parsing a GTFS-RT feed that does not provide explicit tripIds (use test/data/no_trips_realtime_rawdata)', async () => {
    grt = new Gtfsrt2lc({ path: './test/data/no_trips_realtime_rawdata', uris: mock_uris });
    let gti = new GtfsIndex({ path: './test/data/no_trips_static_rawdata.zip' });
    const indexes = await gti.getIndexes({ store: 'LevelStore', deduce: true });
    grt.setIndexes(indexes);

    let connStream = await grt.parse({ format: 'json', objectMode: true });
    let buffer = [];

    expect.assertions(2);

    connStream.on('data', async data => {
        buffer.push(data);
    });

    let stream_end = new Promise(resolve => {
        connStream.on('end', () => {
            resolve(true);
        });
        connStream.on('error', () => {
            resolve(false);
        });
    });

    let finish = await stream_end;

    expect(buffer.length).toBeGreaterThan(0);
    expect(finish).toBeTruthy();
});

test('Test measures to produce consistent connections', () => {
    let update = { "departure": { "delay": 60 }, "arrival": { "delay": 60 } };
    let staticData = { "stop_id": "1234", "departure_time": "08:30:00", "arrival_time": "08:20:00" };
    let serviceDay = new Date('2020-03-03T00:00:00.000Z');

    // Test that stopId, departure and arrival times are explicitly added
    grt.checkUpdate(update, null, staticData, 2, 10, serviceDay);
    expect(update['stopId']).toBe('1234');
    expect(update['departure']['time']).toBe(new Date('2020-03-03T08:31:00.000Z').getTime() / 1000);
    expect(update['arrival']['time']).toBe(new Date('2020-03-03T08:21:00.000Z').getTime() / 1000);

    // Test that the arrival time is corrected
    update['arrival']['time'] = { toNumber: () => { return 0 } };
    grt.checkUpdate(update, null, staticData, 2, 10, serviceDay);
    expect(update['arrival']['time']).toBeGreaterThan(0);

    // Test arrival is added with the current departure delay
    update['arrival'] = undefined;
    let prevUpdate = { "departure": { "delay": 3600 } };
    let timestamp = new Date('2020-03-03T08:21:00.000Z').getTime() / 1000;
    grt.checkUpdate(update, prevUpdate, staticData, 2, 10, serviceDay, timestamp);
    expect(update['arrival']['delay']).toBe(3600);
    expect(update['arrival']['time']).toBe(new Date('2020-03-03T09:20:00.000Z').getTime() / 1000);

    // Test arrival is added with the previous departure delay
    update['arrival'] = undefined;
    update['departure']['delay'] = 60;
    update['departure']['time'] = new Date('2020-03-03T08:31:00.000Z').getTime() / 1000;
    prevUpdate = { "departure": { "delay": 3600 } };
    timestamp = new Date('2020-03-03T10:21:00.000Z').getTime() / 1000;
    grt.checkUpdate(update, prevUpdate, staticData, 2, 10, serviceDay, timestamp);
    expect(update['arrival']['delay']).toBe(60);
    expect(update['arrival']['time']).toBe(new Date('2020-03-03T08:21:00.000Z').getTime() / 1000);
});

test('Non-existent gtfs-rt file throws exception', async () => {
    grt = new Gtfsrt2lc({ path: './data/path/to/fake.file', uris: mock_uris });
    let gti = new GtfsIndex({ path: './test/data/bustang.gtfs.zip' });
    const indexes = await gti.getIndexes({ store: 'MemStore' });
    grt.setIndexes(indexes);

    let failed = null;

    try {
        const connStream = await grt.parse({ format: 'json', objectMode: true });
    } catch (err) {
        failed = err;
    }

    expect(failed).toBeDefined()
});

test('Missing index throws exception', async () => {
    grt = new Gtfsrt2lc({ path: './data/path/bustang.pb', uris: mock_uris });
    let gti = new GtfsIndex({ path: './test/data/bustang.gtfs.zip' });
    const indexes = await gti.getIndexes({ store: 'MemStore' });
    grt.setIndexes(indexes);
    grt.stops = null;

    let failed = null;

    try {
        const connStream = await grt.parse({ format: 'json', objectMode: true });
    } catch (err) {
        failed = err;
    }

    expect(failed).toBeDefined()
});

test('Cover Gtfsrt2LC functions', async () => {
    const gtfsrt2lc = new Gtfsrt2lc({});
    let fail = null;

    try {
        await gtfsrt2lc.handleResponse({ statusCode: 401 });
    } catch (err) {
        fail = err;
    }
    expect(fail).toBeDefined();

    const readStream = new Readable({ objectMode: true, read() { } });
    gtfsrt2lc.handleResponse({
        statusCode: 200,
        headers: { 'content-encoding': 'fake-format' },
        body: Promise.resolve(readStream)
    }).then(result => {
        expect(result).toBe(false);
    });
    readStream.push(null);
});

test('Cover GtfsIndex functions', async () => {
    let gti = new GtfsIndex({ path: 'https://gtfs.irail.be/nmbs/gtfs/latest.zip' });
    try {
        await gti.getIndexes();
    } catch (err) { }

    try {
        await gti.getIndexes({ store: 'fakeFormat' });
    } catch (err) { }

    gti._path = 'http_fake_url';
    try {
        await gti.getIndexes();
    } catch (err) { }

    gti._path = '/some/fake/path';
    try {
        await gti.getIndexes();
    } catch (err) { }

    try {
        await gti.download('http://google.com');
    } catch (err) { }
});

test('Cover Utils functions', async () => {
    // Test for resolve ScheduleRelationship
    const regular = Utils.resolveScheduleRelationship(0);
    const notAvailable = Utils.resolveScheduleRelationship(1);
    const mustPhone = Utils.resolveScheduleRelationship(2);
    const mustCoordinate = Utils.resolveScheduleRelationship(3);

    // Test for URI building function
    const connTimes = Utils.resolveURI(
        uri_templates("http://example.org/test/{connection.departureTime(yyyyMMdd)}/{connection.arrivalTime(yyyyMMdd)}"),
        { departureTime: new Date('2022-09-27'), arrivalTime: new Date('2022-09-27') }
    );

    expect(regular).toBe('gtfs:Regular');
    expect(notAvailable).toBe('gtfs:NotAvailable');
    expect(mustPhone).toBe('gtfs:MustPhone');
    expect(mustCoordinate).toBe('gtfs:MustCoordinateWithDriver');
    expect(connTimes).toBe("http://example.org/test/20220927/20220927")
});