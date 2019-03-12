var SocketCluster = require('socketcluster');

var SerialPort = require("serialport");
const nmea = require('node-nmea');
const net = require('net');
const Readline = SerialPort.parsers.Readline;


var socketCluster = new SocketCluster({
    workers: 1,
    brokers: 1,
    port: 3000,
    appName: "BB Api",
    workerController: __dirname + '/worker.js',
    brokerController: __dirname + '/broker.js',
    socketChannelLimit: 1000,
    rebootWorkerOnCrash: true
});

var options = {'serialPort': '/dev/ttyS1', 'baudRate': 9600, 'port': 3002, 'ipAddress': '192.168.1.100'};
let portS1 = new SerialPort(options.serialPort, {baudRate: options.baudRate, autoOpen: false, lock: false});
portS1.open(function (err) {
    if (err) {
        var errorstr = "Error opening port: " + err.message;

    } else {
        console.log("PORT OPENED");
        const parser = portS1.pipe(new Readline({delimiter: '\r\n'}));

    }
});

