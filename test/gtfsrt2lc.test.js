const GtfsIndex = require('../lib/GtfsIndex');
const Gtfsrt2lc = require('../lib/Gtfsrt2LC');

const static_path = './test/data/static_rawdata.zip';
const rt_path = './test/data/realtime_rawdata';

const mock_uris = {
    "stop": "http://irail.be/stations/NMBS/00{stop_id}",
    "connection": "http://irail.be/connections/{connection.departureStop}/{connection.departureTime(YYYYMMDD)}/{routes.route_short_name}{trips.trip_short_name}",
    "trip": "http://irail.be/vehicle/{routes.route_short_name}{trips.trip_short_name}/{trips.startTime(YYYYMMDD)}",
    "route": "http://irail.be/vehicle/{routes.route_short_name}{trips.trip_short_name}"
};

var routes = null;
var trips = null;
var stops = null;

test('Extract indexes (routes, trips) from sample static GTFS data (test/data/static_rawdata.zip)', async () => {
    let gti = new GtfsIndex(static_path);
    expect.assertions(6);
    const [r, t, s] = await gti.getIndexes();

    routes = r;
    trips = t;
    stops = s;

    expect(r).toBeDefined();
    expect(t).toBeDefined();
    expect(s).toBeDefined();

    expect(r.size).toBeGreaterThan(0);
    expect(t.size).toBeGreaterThan(0);
    expect(s.size).toBeGreaterThan(0);
});

test('Check all parsed connections are consistent regarding departure and arrival times', async () => {
    let grt = new Gtfsrt2lc(rt_path, routes, trips, stops, mock_uris);
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

test('Parse real-time update (test/data/realtime_rawdata) and give it back in json format', async () => {
    let grt2json = new Gtfsrt2lc(rt_path, routes, trips, stops, mock_uris);
    let rt_stream = await grt2json.parse('json');
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

test('Parse real-time update (test/data/realtime_rawdata) and give it back in jsonld format', async () => {
    let grt2json = new Gtfsrt2lc(rt_path, routes, trips, stops, mock_uris);
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
    let grt2json = new Gtfsrt2lc(rt_path, routes, trips, stops, mock_uris);
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
    let grt2json = new Gtfsrt2lc(rt_path, routes, trips, stops, mock_uris);
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
    let grt2json = new Gtfsrt2lc(rt_path, routes, trips, stops, mock_uris);
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
