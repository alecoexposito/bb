var SCWorker = require('socketcluster/scworker');
var SerialPort = require("serialport");
const nmea = require('node-nmea');
const net = require('net');
const Readline = SerialPort.parsers.Readline;
var fs = require('fs');
var express = require('express');
var serveStatic = require('serve-static');
var path = require('path');

var socketClient = require('socketcluster-client');

class Worker extends SCWorker {

    run() {
        var _this = this;
        console.log('   >> Worker PID:', process.pid);
        var scServer = this.scServer;
        var bb = require(__dirname + '/BBCtrl')(SerialPort, nmea, net, fs, Readline, scServer);
        bb.run({'serialPort': '/dev/ttyS1', 'baudRate': 9600, 'port': 3002, 'ipAddress': '192.168.1.100'});
        scServer.on('connection', function (socket) {
            console.log("on connection: ", socket);
        });

        var options = {
            secure: false,
            hostname: '192.168.1.100',
            port: 3001
        };
        var socket = socketClient.connect(options);
        socket.on('connect', function () {
            console.log("conectado al server websocket del tracker");
        });
        var cameraChannel = socket.subscribe('camera_channel');
        cameraChannel.watch(function (data) {
            if (data.type == "start-streaming") {
                _this.runCommand('ffmpeg', ['-r', '30', '-i', 'rtsp://192.168.1.17:554/user=admin&password=&channel=1&stream=1.sdp', 'http://192.168.1.100:8090/feed1.ffm']);
            }
        });
    }

    runCommand(command, params) {
        console.log('starting streaming');
        const
            {spawn} = require('child_process'),
            ls = spawn(command, params);

        ls.stdout.on('data', data => {
            console.log(`stdout: ${data}`);
        });

        ls.stderr.on('data', data => {
            console.log(`stderr: ${data}`);
        });

        ls.on('close', code => {
            console.log(`child process exited with code ${code}`);
        });
    }

}

new Worker();

