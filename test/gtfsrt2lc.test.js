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

var routes = null;
var trips = null;
var stops = null;
var stop_times = null;
var connections = [];


// Make sure travis-ci does not crash due to timeouts
jest.setTimeout(20000);

test('Extract indexes (routes, trips, stops and stop_times) from sample static GTFS data (test/data/static_rawdata.zip)', async () => {
    let gti = new GtfsIndex(static_path);
    expect.assertions(8);
    const [r, t, s, st] = await gti.getIndexes();

    routes = r;
    trips = t;
    stops = s;
    stop_times = st;

    expect(r).toBeDefined();
    expect(t).toBeDefined();
    expect(s).toBeDefined();
    expect(st).toBeDefined();

    expect(r.size).toBeGreaterThan(0);
    expect(t.size).toBeGreaterThan(0);
    expect(s.size).toBeGreaterThan(0);
    expect(st.size).toBeGreaterThan(0);
});

test('Check all parsed connections are consistent regarding departure and arrival times', async () => {
    let grt = new Gtfsrt2lc(rt_path, routes, trips, stops, stop_times, mock_uris);
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

    let stream_end = new Promise((resolve, reject) => {
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
    let grt2json = new Gtfsrt2lc(rt_path, routes, trips, stops, stop_times, mock_uris);
    let rt_stream = await grt2json.parse('jsonld');
    let buffer = [];

    expect.assertions(2);

    rt_stream.on('data', async data => {
        buffer.push(data);
    });

    let stream_end = new Promise((resolve, reject) => {
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
    let grt2json = new Gtfsrt2lc(rt_path, routes, trips, stops, stop_times, mock_uris);
    let rt_stream = await grt2json.parse('csv');
    let buffer = [];

    expect.assertions(2);

    rt_stream.on('data', async data => {
        buffer.push(data);
    });

    let stream_end = new Promise((resolve, reject) => {
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
    let grt2json = new Gtfsrt2lc(rt_path, routes, trips, stops, stop_times, mock_uris);
    let rt_stream = await grt2json.parse('turtle');
    let buffer = [];

    expect.assertions(2);

    rt_stream.on('data', async data => {
        buffer.push(data);
    });

    let stream_end = new Promise((resolve, reject) => {
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
    let grt2json = new Gtfsrt2lc(rt_path, routes, trips, stops, stop_times, mock_uris);
    let rt_stream = await grt2json.parse('ntriples');
    let buffer = [];

    expect.assertions(2);

    rt_stream.on('data', async data => {
        buffer.push(data);
    });

    let stream_end = new Promise((resolve, reject) => {
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

    for(let i in connections) {
        if(connections[i].indexOf(encodeURIComponent('88____:007::8893120:8821006:13:923:20191214:1')) >= 0) {
            testConnections['88____:007::8893120:8821006:13:923:20191214:1'].push(JSON.parse(connections[i]));
        }

        if(connections[i].indexOf(encodeURIComponent('88____:007::8841608:8841004:4:850:20191214')) >= 0) {
            testConnections['88____:007::8841608:8841004:4:850:20191214'].push(JSON.parse(connections[i]));
        }

        if(connections[i].indexOf(encodeURIComponent('88____:007::8819406:8881166:19:834:20190316')) >= 0) {
            testConnections['88____:007::8819406:8881166:19:834:20190316'].push(JSON.parse(connections[i]));
        }
    }
    
    expect(testConnections['88____:007::8893120:8821006:13:923:20191214:1'].length).toBe(12);
    expect(testConnections['88____:007::8841608:8841004:4:850:20191214'].length).toBe(3);
    expect(testConnections['88____:007::8819406:8881166:19:834:20190316'].length).toBe(17);
});

test('Check cancelled vehicle detection and related Connections (use test/data/cancellation_realtime_rawdata)', async () => {
    let gti = new GtfsIndex('./test/data/cancellation_static_rawdata.zip');
    const [r, t, s, st] = await gti.getIndexes();
    let grt = new Gtfsrt2lc('./test/data/cancellation_realtime_rawdata', r, t, s, st, mock_uris);
    let connStream = await grt.parse('json', true);
    let cancelledConnections = [];

    expect.assertions(2);

    connStream.on('data', conn => {
        if(conn['@type'] == 'CancelledConnection') {
            cancelledConnections.push(conn);
        }
    });
    
    let stream_end = new Promise((resolve, reject) => {
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