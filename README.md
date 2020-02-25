# gtfsrt2lc

[![Build Status](https://travis-ci.org/linkedconnections/gtfsrt2lc.svg?branch=master)](https://travis-ci.org/linkedconnections/gtfsrt2lc) [![npm](https://img.shields.io/npm/v/gtfsrt2lc.svg?style=popout)](https://npmjs.com/package/gtfsrt2lc) [![Greenkeeper badge](https://badges.greenkeeper.io/linkedconnections/gtfsrt2lc.svg)](https://greenkeeper.io/) [![Coverage Status](https://coveralls.io/repos/github/linkedconnections/gtfsrt2lc/badge.svg?branch=master)](https://coveralls.io/github/linkedconnections/gtfsrt2lc?branch=master)

Converts [GTFS-RT](https://developers.google.com/transit/gtfs-realtime/) updates to [Linked Connections](http://linkedconnections.org/) following a predefined URI strategy that is provided using the [RFC 6570](https://tools.ietf.org/html/rfc6570) specification and any variable present in a (also given) related [GTFS](https://developers.google.com/tansit/gtfs/reference/) data source.

## Install it

```bash
npm install -g gtfsrt2lc
```

## Test it

If you just want to parse a `GTFS-RT` feed to plain JSON you can do it in the command line as follows:

``` bash
gtfsrt2json -r http://gtfsrt.feed/ -H {\"api-key-if-any\":\"your_api_key\"}
```

See below to see how to use this functionality in your code.

This bundle comes with example data of both `GTFS`  and  `GTFS-RT` data belonging to the Belgian Railway company [NMBS](http://www.belgianrail.be/en/) and that can be used for testing this tool. Once installed, the usage can be checked as follows:

```bash
gtfsrt2lc --help

GTFS-RT to linked connections converter use --help to discover how to use it

  Usage: gtfsrt2lc [options]

  Options:
  -r --real-time <realTime>      URL/path to gtfs-rt feed
  -s --static <static>           URL/path to static gtfs feed
  -u --uris-template <template>  Templates for Linked Connection URIs following the RFC 6570 specification
  -H --headers <headers>         Extra HTTP headers for requesting the gtfs files. E.g., {\"api-Key\":\"someApiKey\"}
  -f --format <format>           Output serialization format. Choose from json, jsonld, turtle, ntriples and csv. (Default: json)
  -S --store <store>             Store type: LevelStore (uses your harddisk to avoid that you run out of RAM) or MemStore (default)
  -g --grep                      Use grep to index only the trips present in the GTFS-RT. Useful for dealing with big GTFS feeds in memory.
  -d --deduce                    Create additional indexes to identify Trips on GTFS-RT feeds that do not provide a trip_id
  -h, --help                     output usage information

```

Now, to run the tool with the example data, first download the [datasets](https://github.com/linkedconnections/gtfsrt2lc/tree/master/test/data), provide a URI template (see an example [here](https://github.com/linkedconnections/gtfsrt2lc/blob/master/uris_template_example.json)) and then execute the following command:

```bash
gtfsrt2lc -r /path/to/realtime_rawdata -s /path/to/static_rawdata.zip -u /path/to/uris_template.json
```

Sometimes, some APIs require you to provide an API key through a custom HTTP header for accessing the data. If that is the case you can do that using the `-H` option and giving a JSON object containing all the required HTTP headers and their values. For example:
```bash
gtfsrtlc -r https://transport.operator/gtfs-rt/api -s https://transport.operator/gtfs/api -u /path/to/uris_template.json -H "{ \"Custom-Header\": \"secret_api_key\" }"
```

Also, some GTFS-RT feeds do not explicitly provide the `trip_id` of `TripDescriptor`s. According to the [spec](https://gtfs.org/reference/realtime/v2/#message-tripdescriptor), it needs to be deduced from the `routeId`, `startDate`, `startTime` and `directioId`. To do this, we need to rely on additional GTFS indexes, which can be enabled by using the option `-d`.

If you are using this tool as a library in a periodic process (e.g., fetching GTFS-RT updates every 30s), it is useful to reuse the static indexes needed to complete the Connections data. Creating such indexes may take while, depending on the size of the GTFS feed. Therefore, it is recommended to run the process for getting the indexes once and keep them either in memory (use `-S MemStore`) or on disk (use `-S LevelStore`), depending on the size of the GTFS feed and your hardware capabilities.

If you are processing data with a big GTFS feed and you don't want to store the indexes on disk, we also provide an alternative approach that first analyzes the GTFS-RT feed to find which trips are being updated, and extracts only the indexes for these trips, using the  [`grep`](https://en.wikipedia.org/wiki/Grep) Unix command.  This approach could be used to build in-memory caches containing the required indexes. Keep in mind that the time to build the indexes scales proportionally to the amount of updated trips.

## How does it work

Providing globally unique identifiers to the different entities that comprise a public transport network is fundamental to lower the adoption cost of public transport data in route-planning applications. Specifically in the case of live updates about the schedules is important to maintain stable identifiers that remain valid over time. Here we use the Linked Data [principles](https://www.w3.org/DesignIssues/LinkedData.html) to transform schedule updates given in the `GTFS-RT` format to [Linked Connections](http://linkedconnections.org/) and we give the option to serialize them in JSON, CSV or RDF (turtle, N-Triples or JSON-LD) format.

The URI strategy to be used during the conversion process is given following the [RFC 6570](https://tools.ietf.org/html/rfc6570) specification for URI templates. Next we describe how can the URI strategy be defined through an example. A basic understanding of the `GTFS` [specification](https://developers.google.com/transit/gtfs/reference/) is required.

### URI templates

To define the URI of the different entities that are referenced in a Linked Connection, we use a single JSON file that contains the respective URI templates. We provide an example of such file [here](https://github.com/linkedconnections/gtfsrt2lc/blob/master/uris_template_example.json) which looks like this:

```js
{
    "stop": "http://example.org/{agency}/stations/{stops.stop_id}",
    "route": "http://example.org/routes/{routeFrom}/{routeTo}/{routes.route_id}",
    "trip": "http://example.org/trips/{routeLabel}/{tripStartTime}",
    "connection": "http://example.org/connections/{routeLabel}/{connection.departureStop}/{tripStartTime}/",
    "resolve": {
        "agency": "routes.agency_id.substring(0, 4);",
        "routeFrom": "routes.route_long_name.replace(/\\s/gi, '').split('--')[0];",
        "routeTo": "routes.route_long_name.replace(/\\s/gi, '').split('--')[1];",
        "routeLabel": "routes.route_short_name + routes.route_id;",
        "tripStartTime": "format(trips.startTime, \"YYYYMMDD'T'HHmm\"");"
    }
}
```

The parameters used to build the URIs are determined using an object-like notation (`object.variable`) where the left side references one of the CSV files present in the `GTFS` data source and the right side references a specific column of such file. For example, taking the [`routes.txt`](https://developers.google.com/transit/gtfs/reference/#routestxt) file from the Belgian Railway company `GTFS` data source:

|route_id|agency_id|route_short_name|route_long_name                 |route_type|
|--------|---------|----------------|--------------------------------|----------|
|111     |NMBS/SNCB|IC              |Bruges -- Knokke                |2         |
|150     |NMBS/SNCB|S1              |Bruxelles-Midi -- Anvers-Central|2         |
|141     |NMBS/SNCB|L               |Charleroi-Sud -- Mariembourg    |2         |
|...     |...      |...             |...                             |...       |

We can reference the route IDs through an object-like notation as `routes.route_id`. In this way we can use the raw GTFS data to build persistent URIs for the main entities in a Linked Connection: `stop`, `route`, `trip` and the `connection` itself, as can be seen in the URI template [example](https://github.com/linkedconnections/gtfsrt2lc/blob/master/uris_template_example.json).

Furthermore, we can also refer to a _special_ object called `connection`. This object acts as a helper tool that exposes useful parameters to define stable URIs. It contains the following data:

```js
connection: {
    "departureStop": "departure stop id",
    "departureTime": Date,
    "arrivalStop": "arrival stop id",
    "arrivalTime": Date
}
```

### Advanced usage

In our experience working with `GTFS` and `GTFS-RT` feeds from different public transport operators we have noticed that a very useful parameter to create persistent and coherent URIs, is the _start time_ of a `trip`. Normally, to get this piece of data from a `GTFS` data source you need to cross-reference at least `trips.txt`, `calendar.txt` and `stop_times.txt`.

For `GTFS-RT` is much easier as the specification defines it as part of a [`TripDescriptor`](https://developers.google.com/transit/gtfs-realtime/reference/#message-tripdescriptor) instance with the name of `start_time`. We expose this piece of data to be reused for creating stable URIs as: `trips.startTime`.

Also, depending of your data source, sometimes you would like to have very specific formatting to have nicer URIs. For example, getting rid of blank spaces, using only parts of certain values or setting a specific format for a `Date`. For this we use the `resolve` object in our URI template. In this object we can define very specific named parameters using JavaScript and reuse them on the URI definitions (see above URI template). For example:

* If we want to use the `agency_id` defined in `routes.txt`, but only the first part before the `/` (see the example above), then inside `resolve` we can define a variable as `"agency": "routes.agency_id.substring(0, 4);"` and reuse `{agency}` in the URI definitions.

* For formating dates we expose the `format` function from the [`date-fns`](https://date-fns.org/v1.9.0/docs/format) library. We can create specific date formats inside the `resolve` object to be reused in our URIs. For instance `"tripStartTime": "format(trips.startTime, \"YYYYMMDD'T'HHmm\");"`.

### The outcome

Here is how an extracted Linked Connection looks in JSON-LD format:

```json
{
    "@context": {
        "xsd": "http://www.w3.org/2001/XMLSchema#",
        "lc": "http://semweb.mmlab.be/ns/linkedconnections#",
        "gtfs": "http://vocab.gtfs.org/terms#",
        "Connection": "lc:Connection",
        "CancelledConnection": "lc:CancelledConnection",
        "departureStop": {
            "@type": "@id",
            "@id": "lc:departureStop"
        },
        "arrivalStop": {
            "@type": "@id",
            "@id": "lc:arrivalStop"
        },
        "departureTime": {
            "@id": "lc:departureTime",
            "@type": "xsd:dateTime"
        },
        "arrivalTime": {
            "@id": "lc:arrivalTime",
            "@type": "xsd:dateTime"
        },
        "departureDelay": {
            "@id": "lc:departureDelay",
            "@type": "xsd:integer"
        },
        "arrivalDelay": {
            "@id": "lc:arrivalDelay",
            "@type": "xsd:integer"
        },
        "direction": {
            "@id": "gtfs:headsign",
            "@type": "xsd:string"
        },
        "gtfs:trip": {
            "@type": "@id"
        },
        "gtfs:route": {
            "@type": "@id"
        }
    }
}
{
    "@id": "http://example.org/connections/IC111/8861200/20190604T0900",
    "@type": "Connection",
    "departureStop": "http://example.org/NMBS/stations/8861200",
    "arrivalStop": "http://example.org/NMBS/stations/8861416",
    "departureTime": "2019-06-04T09:32:00.000Z",
    "arrivalTime": "2019-06-04T09:56:00.000Z",
    "departureDelay": 360,
    "arrivalDelay": 300,
    "direction": "Luxembourg (l)",
    "gtfs:trip": "http://example.org/trips/IC111/20190604T0900",
    "gtfs:route": "http://example.org/routes/Bruges/Knokke/111"
}
...
```

The tool uses `Node.js` [streams](https://nodejs.org/api/stream.html) to give back the converted data and in the case of JSON-LD format it streams first a `@context` object and then the Linked Connections objects.

## Use it as a library

You can use it in your code as follows:

```javascript
const { GtfsIndex, Gtfsrt2LC } = require('gtfsrt2lc');

// Object used to extract GTFS indexes
const indexer = new GtfsIndex({
    path: <URL/path to your GTFS feed>,
    headers: { apiKey: 'someApiKey' }
});

var parser = new Gtfsrt2LC({
    path: <URL/path to your GTFS-RT feed>,
    uris: 'path/to/your/URI_template.json' 
});

async function parse2LinkedConnections() {
    // If using grep, extract the list of updated trips first.
    let updatedTrips = await parser.getUpdatedTrips();
    // Get GTFS indexes (stops.txt, routes.txt, trips.txt, stop_times.txt)
    let indexes = await indexer.getIndexes({
        store: 'MemStore', // For big GTFS sources use LevelStore
        trips: updatedTrips
    });
    // Set GTFS indexes
	parser.setIndexes(indexes);
    // Create stream of updated Linked Connections
    let rtlc = await parser.parse({ 
        format: 'jsonld' // See above for other supported formats,
        objectMode: true // If true produces Connections as objects
    });
    
    for await (const connection of rtlc) {
        console.log(connection);
    }
}

// Parse a GTFS-RT feed to plain JSON
async function parse2Json() {
    console.log(await parser.parse2Json())
}

parse2LinkedConnections();
parse2Json();
```

## Authors

Julian Rojas - [julianandres.rojasmelendez@ugent.be](mailTo:julianandres.rojasmelendez@ugent.be)
