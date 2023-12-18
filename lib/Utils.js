const fs = require('fs');
const { format } = require('date-fns');
const AdmZip = require('adm-zip');

function unzip(zipped, path) {
    const adm = new AdmZip(zipped);
    adm.extractAllTo(path, true);
 }

function resolveURI(template, raw, resolve, stopType) {
    let varNames = template.varNames;
    let fillerObj = {};

    for (let v of varNames) {
        fillerObj[v] = resolveValue(v, raw, resolve || {}, stopType);
    }

    return template.fill(fillerObj);
}

function resolveValue(param, connection, resolve, stopType) {
    // Entity objects to be resolved as needed
    let trips = connection.trip;
    let routes = connection.route;
    let stops = stopType ? connection[stopType] : null;

    // try first to resolve using keys in 'resolve' object
    if (resolve[param]) {
        return eval(resolve[param]);
    }

    // GTFS source file and attribute name
    let source = param.split('.')[0];
    let attr = param.split('.')[1];
    // Resolved value
    let value = null;

    switch (source) {
        case 'trips':
            if (attr.indexOf('startTime') >= 0) {
                let dateFormat = attr.match(/\((.*?)\)/)[1];
                value = format(trips.startTime, dateFormat);
            } else {
                value = trips[attr];
            }
            break;
        case 'routes':
            value = routes[attr];
            break;
        case 'stops':
            value = stops[attr];
            break;
        case 'connection':
            if (attr.indexOf('departureTime') >= 0) {
                let dateFormat = attr.match(/\((.*?)\)/)[1];
                value = format(connection.departureTime, dateFormat);
            } else if (attr.indexOf('arrivalTime') >= 0) {
                let dateFormat = attr.match(/\((.*?)\)/)[1];
                value = format(connection.arrivalTime, dateFormat);
            } else {
                value = connection[attr];
            }
            break;
    }

    return value;
}

function resolveScheduleRelationship(value) {
    if (!value || value == 0) {
        return 'gtfs:Regular';
    } else if (value == 1) {
        return 'gtfs:NotAvailable';
    } else if (value == 2) {
        return 'gtfs:MustPhone'
    } else if (value == 3) {
        return 'gtfs:MustCoordinateWithDriver';
    }

}

module.exports = {
    unzip,
    resolveURI,
    resolveScheduleRelationship
}