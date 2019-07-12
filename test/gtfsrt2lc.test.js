const GtfsIndex = require('../lib/GtfsIndex');
const Gtfsrt2lc = require('../lib/Gtfsrt2LC');

const static_path = './test/data/static_rawdata.zip';
const rt_path = './test/data/realtime_rawdata';

const mock_uris = {
    "stop": "http://irail.be/stations/NMBS/00{stops.stop_id}",
    "route": "http://irail.be/vehicle/{routes.route_id}",
    "trip": "http://irail.be/vehicle/{trips.trip_id}/{trips.startTime(YYYYMMDDTHHmm)}",
    "connection": "http://irail.be/connections/{headsign}/{connection.departureStop}/{trips.startTime(YYYYMMDDTHHmm)}",
    "resolve": {
        "headsign": "trips.trip_headsign.replace(/\\s/, '');"
    }
};

var updatedTrips = null;
var routes = null;
var trips = null;
var stops = null;
var stop_times = null;
var grt = null;
var connections = [];


// Make sure travis-ci does not crash due to timeouts
jest.setTimeout(120000);

test('Obtain the list of trips to be updated from GTFS-RT data', async () => {
    expect.assertions(2);
    grt = new Gtfsrt2lc(rt_path, mock_uris);
    updatedTrips = await grt.getUpdatedTrips();
    expect(updatedTrips).toBeDefined();
    expect(updatedTrips.length).toBeGreaterThan(0);
});

test('Extract indexes (routes, trips, stops and stop_times) from sample static GTFS data (test/data/static_rawdata.zip)', async () => {
    let gti = new GtfsIndex(static_path);
    expect.assertions(8);
    const indexes = await gti.getIndexes(updatedTrips);
    grt.setIndexes(indexes);

    routes = indexes.routes;
    trips = indexes.trips;
    stops = indexes.stops;
    stop_times = indexes.stop_times;

    expect(routes).toBeDefined();
    expect(trips).toBeDefined();
    expect(stops).toBeDefined();
    expect(stop_times).toBeDefined();

    expect(routes.size).toBeGreaterThan(0);
    expect(trips.size).toBeGreaterThan(0);
    expect(stops.size).toBeGreaterThan(0);
    expect(stop_times.size).toBeGreaterThan(0);
});

test('Check all parsed connections are consistent regarding departure and arrival times', async () => {
    let connStream = await grt.parse('json');
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

    let finish = await stream_end;

    expect(flag).toBeTruthy();
    expect(finish).toBeTruthy();
});


test('Parse real-time update (test/data/realtime_rawdata) and give it back in jsonld format', async () => {
    let rt_stream = await grt.parse('jsonld');
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
    let rt_stream = await grt.parse('csv');
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

test('Parse real-time update (test/data/realtime_rawdata) and give it back in turtle format', async () => {
    let rt_stream = await grt.parse('turtle');
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
    let rt_stream = await grt.parse('ntriples');
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

test('Stop gaps introduced by the GTFS-RT updates wrt the static schedule are filled correctly', () => {
    expect.assertions(3);
    // Trip 88____:007::8893120:8821006:13:923:20191214:1 => First 3 stop updates are matched in schedule (13 in total)
    // Trip 88____:007::8841608:8841004:4:850:20191214 => Second and third stop updates are matched in schedule (4 in total)
    // Trip 88____:007::8819406:8881166:19:834:20190316 => Third and fifth stop updates are matched in schedule (19 in total)

    let testConnections = {
        '88____:007::8893120:8821006:13:923:20191214:1': [],
        '88____:007::8841608:8841004:4:850:20191214': [],
        '88____:007::8819406:8881166:19:834:20190316': []
    };

    for (let i in connections) {
        if (connections[i].indexOf(encodeURIComponent('88____:007::8893120:8821006:13:923:20191214:1')) >= 0) {
            testConnections['88____:007::8893120:8821006:13:923:20191214:1'].push(JSON.parse(connections[i]));
        }

        if (connections[i].indexOf(encodeURIComponent('88____:007::8841608:8841004:4:850:20191214')) >= 0) {
            testConnections['88____:007::8841608:8841004:4:850:20191214'].push(JSON.parse(connections[i]));
        }

        if (connections[i].indexOf(encodeURIComponent('88____:007::8819406:8881166:19:834:20190316')) >= 0) {
            testConnections['88____:007::8819406:8881166:19:834:20190316'].push(JSON.parse(connections[i]));
        }
    }

    expect(testConnections['88____:007::8893120:8821006:13:923:20191214:1'].length).toBe(12);
    expect(testConnections['88____:007::8841608:8841004:4:850:20191214'].length).toBe(3);
    expect(testConnections['88____:007::8819406:8881166:19:834:20190316'].length).toBe(17);
});

test('Check cancelled vehicle detection and related Connections (use test/data/cancellation_realtime_rawdata)', async () => {
    grt = new Gtfsrt2lc('./test/data/cancellation_realtime_rawdata', mock_uris);
    let ut = await grt.getUpdatedTrips();
    let gti = new GtfsIndex('./test/data/cancellation_static_rawdata.zip');
    const indexes = await gti.getIndexes(ut);
    grt.setIndexes(indexes);

    let connStream = await grt.parse('json', true);
    let cancelledConnections = [];

    expect.assertions(2);

    connStream.on('data', conn => {
        if(conn['@type'] == 'CancelledConnection') {
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

test('Test parsing a GTFS-RT v2.0 file (use test/data/realtime_rawdata_v2)', async () => {
    grt = new Gtfsrt2lc('./test/data/realtime_rawdata_v2', mock_uris);
    let ut = await grt.getUpdatedTrips();
    let gti = new GtfsIndex('./test/data/static_rawdata_v2.zip');
    const indexes = await gti.getIndexes(ut);
    grt.setIndexes(indexes);

    let connStream = await grt.parse('json', true);
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