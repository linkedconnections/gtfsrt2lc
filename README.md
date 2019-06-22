# gtfsrt2lc

[![Build Status](https://travis-ci.org/linkedconnections/gtfsrt2lc.svg?branch=master)](https://travis-ci.org/linkedconnections/gtfsrt2lc) [![npm](https://img.shields.io/npm/v/gtfsrt2lc.svg?style=popout)](https://npmjs.com/package/gtfsrt2lc) [![Greenkeeper badge](https://badges.greenkeeper.io/linkedconnections/gtfsrt2lc.svg)](https://greenkeeper.io/)

Converts [GTFS-RT](https://developers.google.com/transit/gtfs-realtime/) updates to [Linked Connections](http://linkedconnections.org/) following a predefined URI strategy that is provided using the [RFC 6570](https://tools.ietf.org/html/rfc6570) specification and any variable present in a (also given) related [GTFS](https://developers.google.com/tansit/gtfs/reference/) data source.

## Install it

```bash
npm install -g gtfsrt2lc
```

## Test it

This bundle comes with example data of both, a `GTFS` data source and a `GTFS-RT` update that belong to the Belgian Railway company [NMBS](http://www.belgianrail.be/en/) and that can be used for testing this tool. Once installed, the usage can be checked as follows:

```bash
gtfsrt2lc --help

GTFS-RT to linked connections converter use --help to discover how to use it

  Usage: gtfsrt2lc [options]

  Options:

    -r --real-time <realTime>      URL/path to gtfs-rt feed
    -s --static <static>           URL/path to static gtfs feed
    -u --uris-template <template>  JSON object/file with the required URI templates following the RFC 6570 specification
    -f --format <format>           Output serialization format. Choose from json, jsonld, turtle, ntriples and csv. (Default: json)
    -h, --help                     Output usage information
```

Now, to run the tool with the example data, first download the [datasets](https://github.com/linkedconnections/gtfsrt2lc/tree/master/test/data), provide the URI templates (see an example [here](https://github.com/linkedconnections/gtfsrt2lc/blob/master/uris_template_example.json)) and then execute the following command:

```bash
gtfsrt2lc -r /path/to/realtime_rawdata -s /path/to/static_rawdata.zip -u /path/to/uris_template.json
```

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
        "tripStartTime": "format(trips.startTime, 'YYYYMMDDTHHmm');"
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

* For formating dates we expose the `format` function from the [`date-fns`](https://date-fns.org/v1.9.0/docs/format) library. We can create specific date formats inside the `resolve` object to be reused in our URIs. For instance `"tripStartTime": "format(trips.startTime, 'YYYYMMDDTHHmm');"`.

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
const { GtfsIndex, Gtfsrt2LC} = require('gtfsrt2lc');

// Get static GTFS indexes
const indexer = new GtfsIndex(<path or URL to your GTFS datasource>);
indexer.getIndexes().then(async ([routes, trips, stops, stop_times]) => {
    // Proceed to parse GTFS-RT
    let parser = new Gtfsrt2LC(<path or URL to your GTFS-RT update>, routes, trips, stops, stop_times, 'path/to/your/URI_template.json');
    // Choose the serialization format among json, jsonld, csv, turtle and ntriples
    let rtlc = await parser.parse('jsonld');
    // Output data
    rtlc.on('data', data => {
        console.log(data);
    });
}).catch(err => {
    console.error(err);
});
```

## Authors

Julian Rojas - [julianandres.rojasmelendez@ugent.be](mailTo:julianandres.rojasmelendez@ugent.be)
