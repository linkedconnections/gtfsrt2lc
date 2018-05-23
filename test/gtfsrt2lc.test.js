const GtfsIndex = require('../lib/gtfsIndex.js');
const Gtfsrt2lc = require('../lib/gtfsrt2lc');

const static_path = './test/data/static_rawdata.zip';
const rt_path = './test/data/realtime_rawdata';

const mock_uris = {
    "stop": "http://example.org/stations/{stop_id}",
    "route": "http://example.org/routes/{routes.route_short_name}{trips.trip_short_name}",
    "trip": "http://example.org/trips/{routes.route_short_name}{trips.trip_short_name}/{calendar_dates.date}",
    "connection": "http://example.org/connections/{connection.departureStop}/{calendar_dates.date}/{routes.route_short_name}{trips.trip_short_name}"
};

var routes = null;
var trips = null;
var cal_dates = null;


test('Extract indexes (routes, trips, calendar_dates) from sample static GTFS data (test/data/static_rawdata.zip)', async () => {
    let gti = new GtfsIndex(static_path);
    expect.assertions(6);
    const [r, t, cd] = await gti.getIndexes();

    routes = r;
    trips = t;
    cal_dates = cd;

    expect(r).toBeDefined();
    expect(t).toBeDefined();
    expect(cd).toBeDefined();

    expect(r.size).toBeGreaterThan(0);
    expect(t.size).toBeGreaterThan(0);
    expect(cd.size).toBeGreaterThan(0);
});

test('Parse real-time update (test/data/realtime_rawdata) and give it back in json format', async () => {
    let grt2json = new Gtfsrt2lc(rt_path, routes, trips, cal_dates, mock_uris);
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
    let grt2json = new Gtfsrt2lc(rt_path, routes, trips, cal_dates, mock_uris);
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
    let grt2json = new Gtfsrt2lc(rt_path, routes, trips, cal_dates, mock_uris);
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
    let grt2json = new Gtfsrt2lc(rt_path, routes, trips, cal_dates, mock_uris);
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
    let grt2json = new Gtfsrt2lc(rt_path, routes, trips, cal_dates, mock_uris);
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
