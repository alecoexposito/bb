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
const del = require('del');
var ps = require('ps-node');
var lr = require('readline');
var moment = require('moment');
var Readable = require('stream').Readable

var socketClient = require('socketcluster-client');

class Worker extends SCWorker {

    constructor() {
        super();
        var sqlite3 = require('sqlite3').verbose();
        this.db = new sqlite3.Database('/home/zurikato/.db/bb.sqlite', sqlite3.OPEN_READWRITE, (err) => {
            if(err) {
                return console.log("error openning the sqlite database");
            }
            console.log('connected to the sqlite database');
        });
        this.sendImage = false;
        this.livePid = null;
        this.lastTimestamp = null;
        this.clientSocketTracker = new net.Socket();
        this.clientSocketTracker.connect(process.env.TRACKER_SOCKET_PORT, process.env.TRACKER_IP, function() {
            console.log("connected to tracker tcp socket");
        });
        /**
         * In this array will be saved the state of every running process, its pid, its lastTimestamp, idCamera and the sendImageFlag
         * @type {Array}
         */
        this.currentPids = [];

    }

    findRunningProcess(idCamera) {
        for(var i = 0; i < this.currentPids.length; i++) {
            var currentProcess = this.currentPids[i];
            if(currentProcess.idCamera == idCamera)
                return currentProcess;
        }
        return null;
    }

    runningProcessIndex(idCamera) {
        for(var i = 0; i < this.currentPids.length; i++) {
            var currentProcess = this.currentPids[i];
            if(currentProcess.idCamera == idCamera)
                return i;
        }
        return -1;
    }

    addRunningProcess(idCamera, pid) {
        var index = this.runningProcessIndex(idCamera);
        if(index != -1) {
            this.currentPids[index].pid = pid;
            this.currentPids[index].sendImage = true;
        } else {
            var runningProcess = {
                idCamera: idCamera,
                pid: pid,
                lastTimestamp: moment().unix(),
                sendImage: true
            };
            this.currentPids.push(runningProcess);
        }
    }

    stopRunningProcess(idCamera) {
        var index = this.runningProcessIndex(idCamera);
        this.currentPids[index].pid = null;
        this.currentPids[index].sendImage = false;
    }

    // var sendImage;
    sendImageWebsocket(cameraVideoChannel, idCamera) {
        var _this = this;
        var currentProcess = _this.findRunningProcess(idCamera);
        if(currentProcess.sendImage) {
            console.log("enviando");
            var imageFile = fs.readFileSync("/home/zurikato/camera-local/camera-" + idCamera + ".jpg");

            cameraVideoChannel.publish({image: imageFile.toString("base64"), idCamera: idCamera});
            setTimeout(function() {
                _this.sendImageWebsocket(cameraVideoChannel, idCamera);
            }, 300)
        } else {
            console.log("se acabo la enviadera");
        }

    }

    syncOfflineData(client) {
        console.log("sincronizando datos offline");
        var _this = this;
        let sql = "select * from info_data where is_offline = 1";

        _this.db.each(sql, [], (err, row) => {
            if (err) {
                throw err;
            }
            console.log("row: ", row);
            let response = {
                'device_id': row.device_id,
                'latitude': row.lat,
                'longitude': row.lng,
                'speed': row.speed,
                'createdAt': moment(Number.parseFloat(row.created_at)).format("YYYY-MM-DD HH:mm:ss"),
                'updatedAt': moment(Number.parseFloat(row.updated_at)).format("YYYY-MM-DD HH:mm:ss")
            };
            let buffer = Buffer.from(JSON.stringify(response));
            client.write(buffer, function(err) {
                if(err) {
                    console.log("error enviando el dato offline");
                } else {
                    console.log("--------------------- enviado el dato offline -------------------------");
                }
            });
            console.log("a guardar en server: ", {deviceModel: 'BB', gpsData: response});
        }, (err, count) => {
            if(err) {
                return console.log("error ocurred retrieving offline data from sqlite");
            }

            _this.db.run('update info_data set is_offline = 0 where is_offline = 1', [], function(err) {
                if(err) {
                    return console.log(console.log(err.message));
                }

                console.log('updateados a 0 los datos offline sincronizados');
            });

        });



    }

    run() {
        var _this = this;
        console.log('   >> Worker PID:', process.pid);
        var scServer = this.scServer;
        var bb = require(__dirname + '/BBCtrl')(SerialPort, nmea, net, fs, Readline, scServer);
        var optionsClient = {'serialPort': '/dev/ttyS1', 'baudRate': 9600, 'port': 3002, 'ipAddress': process.env.TRACKER_IP};
        var client = new net.Socket();
        client.on('error', function (err) {
            console.log('OCURRIO EL ERROR');
            // console.log(err);
        });


        bb.run(optionsClient, client, _this.db);
        scServer.on('connection', function (socket) {
            console.log("on connection: ", socket);
        });


        var options = {
            secure: false,
            hostname: process.env.TRACKER_IP,
            port: 3001
        };
        var socket = socketClient.connect(options);
        socket.on('connect', function () {
            console.log("conectado al server websocket del tracker");
            client.connect(optionsClient.port, optionsClient.ipAddress, function () {
                console.log('----------------------------- CLIENT CONNECTED ------------------------------');
                _this.syncOfflineData(client);

            });
        });
        socket.on('error', function(err) {
            console.log("error ocurred");
        });

        var cameraChannel = socket.subscribe('camera_channel');
        var cameraVideoChannel = socket.subscribe('camera_' + process.env.DEVICE_ID + '_channel');
        cameraChannel.watch(function (data) {
            if(data.id == process.env.DEVICE_ID) {
                if (data.type == "start-streaming") {
                    console.log("AAAAAAAAAAAAAAAAAAAAAA--------------received from web:------------AAAAAAAAAAAAAAA ", data);

                    if(data.multiple) {
                        _this.runMultipleCameras(data, cameraVideoChannel);
                    } else {
                        var idCamera = data.idCamera;
                        var urlCamera = data.urlCamera;
                        _this.runSingleCamera(idCamera, urlCamera, cameraVideoChannel);
                    }

                    // setTimeout(function() {
                    //     vcommand.kill("SIGKILL");
                    // }, 120000)
                } else if(data.type == "stop-streaming") {
                    console.log("AAAAAAAAAAAAAAAAAAAAAA--------------received from web:------------AAAAAAAAAAAAAAA ", data);
                    var interval = setInterval(function() {
                        var idCamera = data.idCamera;
                        var currentProcess = _this.findRunningProcess(idCamera);
                        if((moment().unix() - currentProcess.lastTimestamp) >= 20) {
                            var pid = currentProcess.pid;
                            console.log("------ killinig process with pid: -----------", pid);
                            process.kill(-pid, "SIGKILL");
                            _this.stopRunningProcess(idCamera);
                            clearInterval(interval);
                        }
                    }, 12000)

                    // vcommand.kill("SIGKILL");
                } else if(data.type == "start-video-backup") {
                    var location = process.env.VIDEO_BACKUP_LOCATION;
                    console.log("Stream from backup: ", data);
                    var initialDate = data.initialDate;
                    var endDate = data.endDate;
                    console.log(initialDate);

                    var videoBackupChannel = socket.subscribe(data.playlistName + '_channel');

                    var playlistFolder = "/home/zurikato/camera/video/" + data.playlistName;
                    var playlistFile = "/home/zurikato/camera/video/" + data.playlistName + "/playlist.m3u8";
                    _this.initPlayList(playlistFile, playlistFolder);

                    var count = 1;
                    var lineReader = lr.createInterface({
                        input: fs.createReadStream(location + '/playlist.m3u8')
                    });

                    console.log("log 1");

                    var lastUtilityLine = "";
                    var noFileFound = true;
                    lineReader.on('line', function (line) {
                        console.log("log 2");
                        if(line.startsWith("#")) {
                            lastUtilityLine = line;
                        } else {
                            if(line >= initialDate && line <= endDate) {
                                console.log("line added: ", line);
                                noFileFound = false;
                                // _this.runCommand("cp", [
                                //     location + '/' + line,
                                //     playlistFolder + "/" + line
                                // ]);
                                let filePath = location + '/' + line;
                                _this.sendToServer({type: 'backup-file', file: filePath});
                                _this.addTsToPlaylist(line, playlistFile, lastUtilityLine);
                            } else if(line > endDate) {
                                console.log("ultima linea leida");
                                lineReader.close();
                            }
                        }
                        console.log("log 3");

                    });

                    lineReader.on('close', function() {
                        console.log("process finished");
                        if(noFileFound == true) {
                            videoBackupChannel.publish({ type: "no-video-available" });
                        }else {
                            _this.writeToPlayList(playlistFile, "#EXT-X-ENDLIST");
                            videoBackupChannel.publish({ type: "play-recorded-video" });
                        }
                    });
                } else if(data.type == "stop-video-backup") {
                    var folderPath = "/home/zurikato/camera/video/" + data.playlistName;
                    del([folderPath], {force: true}).then(paths => {
                        console.log('Deleted files and folders:\n', paths.join('\n'));
                    });
                    // _this.deleteFolderFiles(folderPath);
                    // fs.rmdirSync(folderPath);
                } else if(data.type == "begin-download") {
                    console.log("entrando en el begin download")
                    var totalTime = data.endTime - data.initialTime;

                    _this.downloadVideoByTime(data.initialTime, totalTime, data.playlistName, socket);
                }
            }
        });
        cameraVideoChannel.watch(function(data) {
            if(data.type && data.type == "feedback") {
                console.log("feedback: ", data);
                var idCamera = data.idCamera;
                if(idCamera != "all") {
                    var index = _this.runningProcessIndex(idCamera);
                    _this.currentPids[index].lastTimestamp = moment().unix();
                    // _this.lastTimestamp = moment().unix();
                }
            }
        });

        var obdChannel = socket.subscribe('obd_channel');
        obdChannel.watch(function(data) {
            if(data.id == process.env.DEVICE_ID) {
                if (data.type == "obd-info") {
                    console.log("going to run the python command");

                    const
                        {spawn} = require('child_process'),
                        vcommand = spawn(command, params);

                    var response =  "";
                    vcommand.stdout.on('data', data => {
                        response += data;
                    });

                    vcommand.stderr.on('data', data => {
                        console.log(`stderr: ${data}`);
                    });

                    vcommand.on('close', code => {
                        obdChannel.publish({ type: 'obd-info-response', message: response });
                    });

                }
            }
        });
    }

    downloadVideoByTime(initialTime, totalTime, playlistName, socket) {
        console.log("entered in download video by time");
        console.log("initial time: ", initialTime);
        console.log("total time: ", totalTime);
        var location = "/home/zurikato/camera/video/" + playlistName;
        if(fs.existsSync(location + "/videos.txt")) {
            fs.truncateSync(location + "/videos.txt", 0);
        }

        fs.readdir(location, (err, files) => {
                var noFileFound = true;
                var firstPass = true;
                var initialDate = null;
                var endDate = null;
                var noFileFound = true;
                var _this = this;
                var scriptsLocation = "/home/zurikato/scripts";
                files.forEach(file => {
                    noFileFound = false;
                    if(file != 'playlist.m3u8') {
                        if(firstPass) {
                            var dateStr = file.replace("_hls.ts", "");
                            var fileDate = moment(dateStr, 'YYYY-MM-DD_HH-mm-ss');
                            var initialDateTmp = fileDate.add(Math.floor(initialTime), 'seconds');
                            initialDate = initialDateTmp.format('YYYY-MM-DD_HH-mm-ss') + "_hls.ts";
                            endDate = initialDateTmp.add(Math.ceil(totalTime), 'seconds').format('YYYY-MM-DD_HH-mm-ss') + "_hls.ts";
                            console.log("initial date: ", initialDate);
                            console.log("end date: ", endDate);
                            firstPass = false;
                        }
                        var filename = location + "/videos.txt";
                        if(file >= initialDate && file <= endDate) {
                            console.log("included file: ", file);
                            fs.appendFileSync(filename, "file " + file + "\n", function(err) {
                                if(err) {
                                    return console.log("error: ", err);
                                }
                            });
                        }
                    }
                });
                var videoBackupChannel = socket.subscribe(playlistName + '_channel');
                _this.runCommand("sh", [
                    scriptsLocation + '/join-cut-segments.sh',
                    initialTime,
                    totalTime,
                    playlistName
                ], function() {
                    videoBackupChannel.publish({ type: "download-ready" });
                });

                if(noFileFound == true) {
                    videoBackupChannel.publish({ type: "no-video-available" });
                }
            });

    }

    runCommand(command, params, closeCallback) {
        var _this = this;
        const
            {spawn} = require('child_process'),
            vcommand = spawn(command, params, {
                detached: true
            });

        vcommand.stdout.on('data', data => {
            console.log(`stdout: ${data}`);
        });

        vcommand.stderr.on('data', data => {
            console.log(`stderr: ${data}`);
        });

        vcommand.on('close', code => {
            if(closeCallback !== undefined) {
                console.log("executing callback function");
                closeCallback();
            }
            _this.livePid = null;
            console.log('------------------child process exited with code ${code} ----------------');
        });
        return vcommand;
    }

    writeToPlayList(filename, data) {
        fs.appendFileSync(filename, data, function(err) {
            if(err) {
                return console.log("error: ", err);
            }
        });
    }

    initPlayList(filename, playlistFolder) {
        fs.mkdirSync(playlistFolder);
        this.writeToPlayList(filename, "#EXTM3U\n");
        this.writeToPlayList(filename, "#EXT-X-VERSION:3\n");
        this.writeToPlayList(filename, "#EXT-X-MEDIA-SEQUENCE:0\n");
        this.writeToPlayList(filename, "#EXT-X-ALLOW-CACHE:YES\n");
        this.writeToPlayList(filename, "#EXT-X-TARGETDURATION:32\n");
    }

    addTsToPlaylist(tsFilename, playlistFilename, infoLine) {
        var infoLineData = "#EXTINF:30.000000,\n";
        if(infoLine !== undefined)
            infoLineData = infoLine + "\n";
        this.writeToPlayList(playlistFilename, infoLineData);
        this.writeToPlayList(playlistFilename, tsFilename + "\n");
        // this.writeToPlayList("#EXT-X-ENDLIST\n");
    }

    deleteFolderFiles(location) {
        fs.readdir(location, (err, files) => {
            if (err) throw err;

            for (const file of files) {
                fs.unlink(path.join(location, file), err => {
                    if (err) throw err;
                });
            }
        });
    }

    runSingleCamera(idCamera, urlCamera, cameraVideoChannel) {
        var _this = this;
        var vcommand = null;

        var currentProcess = _this.findRunningProcess(idCamera);
        if(currentProcess != null && currentProcess.pid != null) {
            console.log("process already openned");
        } else {
            vcommand = _this.runCommand('bash', [
                '/usr/scripts/run-live-video.sh',
                urlCamera,
                "camera-" + idCamera + ".jpg"
            ]);
            var pid = vcommand.pid;
            console.log("------started process with pid: --------", pid);
            // _this.sendImage = true;
            _this.addRunningProcess(idCamera, pid);
            _this.sendImageWebsocket(cameraVideoChannel, idCamera);
        }
    }

    runMultipleCameras(data, cameraVideoChannel) {
        var cameras = data.cameras;
        var _this = this;
        for(var i = 0; i < cameras.length; i++) {
            var idCamera = cameras[i].idCamera;
            var urlCamera = cameras[i].urlCamera;
            console.log("cameras en i: ", cameras[i]);
            _this.runSingleCamera(idCamera, urlCamera, cameraVideoChannel);
        }

        var interval = setInterval(function() {
            var idCamera = cameras[0].idCamera;
            var currentProcess = _this.findRunningProcess(idCamera);
            console.log("en el interval del multiple cameras: " + idCamera, (moment().unix() - currentProcess.lastTimestamp) >= 20);
            if((moment().unix() - currentProcess.lastTimestamp) >= 20) {
                var pid = currentProcess.pid;
                console.log("------ killinig process with pid: -----------", pid);
                process.kill(-pid, "SIGKILL");
                _this.stopRunningProcess(idCamera);
                for(var j = 1; j < cameras.length; j++) {
                    currentProcess = _this.findRunningProcess(cameras[j].idCamera);
                    var pid = currentProcess.pid;
                    console.log("------ killinig process with pid: -----------", pid);
                    process.kill(-pid, "SIGKILL");
                    _this.stopRunningProcess(cameras[j].idCamera);
                }
                clearInterval(interval);
            }
        }, /*12000*/12000)

    }

    sendToServer(data) {
        //send a file to the server
        var fileBuffer = fs.createReadStream(data.file);
        console.log("going to write to server: ", data.file);
        fileBuffer.pipe(this.clientSocketTracker);

        var s = new Readable;
        s.push(data.file);
        s.push(null);
        s.pipe(this.clientSocketTracker);
    }
}

new Worker();

