var SCWorker = require('socketcluster/scworker');
var SerialPort = require("serialport");
const nmea = require('node-nmea');
const net = require('net');
const Readline = SerialPort.parsers.Readline;
var fs = require('fs');
var express = require('express');
var serveStatic = require('serve-static');
var path = require('path');
require("dotenv").config();

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
        var vcommand = null;
        cameraChannel.watch(function (data) {
            if(data.id == process.env.DEVICE_ID) {
                if (data.type == "start-streaming") {
                    console.log("AAAAAAAAAAAAAAAAAAAAAA--------------received from web:------------AAAAAAAAAAAAAAA ", data);
                    vcommand = _this.runCommand('gst-launch-1.0', [
                        'rtspsrc',
                        'location=' + process.env.CAMERA_LOCATION,
                        '!',
                        'decodebin',
                        '!',
                        'jpegenc',
                        '!',
                        'multifilesink',
                        'location=/home/zurikato/camera/camera.jpg'
                    ]);
                    setTimeout(function() {
                        vcommand.kill("SIGKILL");
                    }, 120000)
                } else if(data.type == "stop-streaming") {
                    console.log("AAAAAAAAAAAAAAAAAAAAAA--------------received from web:------------AAAAAAAAAAAAAAA ", data);
                    vcommand.kill("SIGKILL");
                }
            }
        });
    }

    runCommand(command, params) {
        console.log('starting streaming');
        const
            {spawn} = require('child_process'),
            vcommand = spawn(command, params);

        vcommand.stdout.on('data', data => {
            console.log(`stdout: ${data}`);
        });

        vcommand.stderr.on('data', data => {
            console.log(`stderr: ${data}`);
        });

        vcommand.on('close', code => {
            console.log('------------------child process exited with code ${code} ----------------');
        });
        return vcommand;
    }

}

new Worker();

