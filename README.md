# gtfsrt2lc
[![Build Status](https://travis-ci.org/linkedconnections/gtfsrt2lc.svg?branch=master)](https://travis-ci.org/linkedconnections/gtfsrt2lc)

[![NPM](https://nodei.co/npm/gtfsrt2lc.png)](https://npmjs.com/package/gtfsrt2lc)

Converts [GTFS-RT](https://developers.google.com/transit/gtfs-realtime/) updates to [Linked Connections](http://linkedconnections.org/) following a predefined URI strategy that is provided using the [RFC 6570](https://tools.ietf.org/html/rfc6570) specification and any variable present in a (also given) related [GTFS](https://developers.google.com/tansit/gtfs/reference/) datasource.

## Install it

```
$ npm install -g gtfsrt2lc
```

## Test it

This bundle comes with example data of both, a `GTFS` datasource and a `GTFS-RT` update that belong to the Belgian Railway company [NMBS](http://www.belgianrail.be/en/) and that can be used for testing this tool. Once installed, the usage can be checked as follows:
```bash
$ gtfsrt2lc --help
GTFS-RT to linked connections converter use --help to discover how to use it

  Usage: gtfsrt2lc [options]

  Options:

    -r --real-time <realTime>      URL/path to gtfs-rt feed
    -s --static <static>           URL/path to static gtfs feed
    -u --uris-template <template>  Templates for Linked Connection URIs following the RFC 6570 specification
    -f --format <format>           Output serialization format. Choose from json, jsonld, turtle, ntriples and csv. (Default: json)
    -h, --help                     output usage information
```
Now, to run the tool with the example data, first download the [datasets](https://github.com/linkedconnections/gtfsrt2lc/tree/master/test/data), provide the URI templates (see an example [here](https://github.com/linkedconnections/gtfsrt2lc/blob/master/uris_template_example.json)) and then execute the following command:
```bash
$ gtfsrt2lc -r /path/to/realtime_rawdata -s /path/to/static_rawdata.zip -u /path/to/uris_template.json -f jsonld > output.jsonld
```

## How does it work?
Providing globally unique identifiers to the different entities that comprise a public transport network is fundamental to lower the adoption cost of public transport data in route-planning appplications. Specifically in the case of live updates about the schedules is important to mantain stable identifiers that remain valid over time. Here we use the Linked Data [principles](https://www.w3.org/DesignIssues/LinkedData.html) to transform schedule updates given in the `GTFS-RT` format to [Linked Connections](http://linkedconnections.org/) and we give the option to serialize them in JSON, CSV or RDF (turtle, N-Triples or JSON-LD) format.

The URI strategy to be used during the conversion process is given following the [RFC 6570](https://tools.ietf.org/html/rfc6570) specification for URI templates. Next we describe how can the URI strategy be defined through an example. A basic understanding of the `GTFS` [specification](https://developers.google.com/tansit/gtfs/reference/) is required.

### URI templates
In order to define the URI of the different entities of a public transport network that are referenced in a Linked Connection, we use a single JSON file that contains the different URI templates. We provide an example of such file [here](https://github.com/linkedconnections/gtfsrt2lc/blob/master/uris_template_example.json) which looks as follows:
```json
{
    "stop": "http://example.org/stations/{stop_id}",
    "route": "http://example.org/routes/{routes.route_short_name}{trips.trip_short_name}",
    "trip": "http://example.org/trips/{routes.route_short_name}{trips.trip_short_name}/{calendar_dates.date}",
    "connection": "http://example.org/connections/{connection.departureStop}/{calendar_dates.date}/{routes.route_short_name}{trips.trip_short_name}"
}
```
The parameters used to build the URIs are given following an object-like notation (`object.variable`) where the left side references a CSV file present in the provided `GTFS` datasource and the right side references a specific column of such file. We use the data from a reference `GTFS` datasource to create the URIs as with only the data present in a `GTFS-RT` update may not be feasible to create persistent URIs. The `GFTS` files that can be used to create the URIs in the current implementation of this tool are `routes`, `trips` and `calendar_dates`. As for the variables, any column that exists in those files can be referenced. Next we describe how are the entities URIs build based on these templates:

- **stop:** A Linked Connection references 2 different stops (departure and arrival stop). The data used to build these specific URIs comes directly from the `GTFS-RT` update, which is why here we do not specify a CSV file from the reference `GTFS` datasource. The variable name chosen for the example is `stop_id` but it can be freely named.
- **route:** For the route identifier we rely on the `routes.route_short_name` and the `trips.trip_short_name` variables.
- **trip:** In the case of the trip we add the associated `calendar_dates.date` on top of the route URI.
- **connection:** Finally for a connection identifier we resort to its departure stop with `connection.departureStop`, the `calendar_dates.date`, the `routes.route_short_name` and the `trips.trip_short_name`. In this case we reference a special entity we called `connection` which contains the related basic data that can be extracted from a `GTFS-RT` update for every Linked Connection. A `connection` entity contains these parameters that can be used on the URIs definition: `connection.departureStop`, `connection.arrivalStop`, `connection.departureTime` and `connection.arrivalTime`.

How you define your URI strategy to obtain stable identifiers will depend on the actual data that exists on both the `GTFS` datasource and the `GTFS-RT` updates, and how these data is mantained.

### The outcome
Here is how an extracted Linked Connection looks in JSON-LD format:
```json
{
    "@context": {
        "xsd": "http://www.w3.org/2001/XMLSchema#",
        "lc": "http://semweb.mmlab.be/ns/linkedconnections#",
        "gtfs": "http://vocab.gtfs.org/terms#",
        "Connection": "lc:Connection",
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
    "@id": "http://example.org/connections/8861200/20180608/IC2110",
    "@type": "Connection",
    "departureStop": "http://example.org/stations/8861200",
    "arrivalStop": "http://example.org/stations/8861416",
    "departureTime": "2018-05-23T09:32:00.000Z",
    "arrivalTime": "2018-05-23T09:35:00.000Z",
    "departureDelay": 60,
    "arrivalDelay": 0,
    "direction": "Luxembourg (l)",
    "gtfs:trip": "http://example.org/trips/IC2110/20180608",
    "gtfs:route": "http://example.org/routes/IC2110"
}
```
The tool uses `Node.js` [streams](https://nodejs.org/api/stream.html) to give back the converted data and in the case of JSON-LD format it streams first a `@context` object and then the Linked Connections objects.

## Use it as a library
You can use it in your code as follows:
```javascript
const { GtfsIndex, Gtfsrt2LC} = require('gtfsrt2lc');

// Get static GTFS indexes
const indexer = new GtfsIndex('path or URL to your GTFS datasource');
indexer.getIndexes().then(async ([routes, trips, calendar_dates]) => {
    // Proceed to parse GTFS-RT
    let parser = new Gtfsrt2LC('path or URL to your GTFS-RT update', routes, trips, calendar_dates, 'path/to/your/URI_template.json');
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
Julian Rojas - julianandres.rojasmelendez@ugent.be
