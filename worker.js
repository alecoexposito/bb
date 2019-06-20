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

    }
    // var sendImage;
    sendImageWebsocket(cameraVideoChannel) {
        var _this = this;
        if(this.sendImage) {
            console.log("enviando");
            var imageFile = fs.readFileSync("/home/zurikato/camera-local/camera.jpg");

            cameraVideoChannel.publish({image: imageFile.toString("base64")});
            setTimeout(function() {
                _this.sendImageWebsocket(cameraVideoChannel);
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
        var vcommand = null;
        cameraChannel.watch(function (data) {
            if(data.id == process.env.DEVICE_ID) {
                if (data.type == "start-streaming") {
                    console.log("AAAAAAAAAAAAAAAAAAAAAA--------------received from web:------------AAAAAAAAAAAAAAA ", data);
                    if(_this.livePid != null /*_this.isProcessOpenned('gst-launch-1.0')*/) {
                        console.log("process already openned");
                    } else {
                        // vcommand = _this.runCommand('gst-launch-1.0', [
                        //     'rtspsrc',
                        //     'location=' + process.env.CAMERA_LOCATION + ' latency=0',
                        //     '!',
                        //     'decodebin',
                        //     '!',
                        //     'videorate',
                        //     '!',
                        //     'video/x-raw,framerate=5/1',
                        //     '!',
                        //     'jpegenc',
                        //     '!',
                        //     'multifilesink',
                        //     'location=/home/zurikato/camera-local/camera.jpg'
                        // ]);

                        vcommand = _this.runCommand('bash', [
                            '/home/zurikato/scripts/run-live-video.sh'
                        ]);

                        _this.livePid = vcommand.pid;
                        _this.sendImage = true;
                        _this.sendImageWebsocket(cameraVideoChannel);

                    }
                    // setTimeout(function() {
                    //     vcommand.kill("SIGKILL");
                    // }, 120000)
                } else if(data.type == "stop-streaming") {
                    console.log("AAAAAAAAAAAAAAAAAAAAAA--------------received from web:------------AAAAAAAAAAAAAAA ", data);
                    var interval = setInterval(function() {
                        console.log("intervalo current: ", moment().unix());
                        console.log("intervalo last: ", _this.lastTimestamp);
                        console.log("intervalo rest: ", moment().unix() - _this.lastTimestamp);
                        if((moment().unix() - _this.lastTimestamp) >= 20) {
                            _this.sendImage = false;
                            process.kill(-_this.livePid, "SIGKILL")
                            _this.livePid = null;
                            clearInterval(interval);
                        }
                    }, 30)

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

                    var lastUtilityLine = "";
                    var noFileFound = true;
                    lineReader.on('line', function (line) {
                        if(line.startsWith("#")) {
                            lastUtilityLine = line;
                        } else {
                            if(line >= initialDate && line <= endDate) {
                                console.log("line added: ", line);
                                noFileFound = false;
                                _this.runCommand("cp", [
                                    location + '/' + line,
                                    playlistFolder + "/" + line
                                ]);
                                _this.addTsToPlaylist(line, playlistFile, lastUtilityLine);
                            } else if(line > endDate) {
                                console.log("ultima linea leida");
                                lineReader.close();
                            }
                        }
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



                    // fs.readdir(location, (err, files) => {
                    //     var noFileFound = true;
                    //     files.forEach(file => {
                    //         if(file != 'playlist.m3u8' && file >= initialDate && file <= endDate) {
                    //             noFileFound = false;
                    //             _this.runCommand("cp", [
                    //                 location + '/' + file,
                    //                 playlistFolder + "/" + file
                    //             ]);
                    //             _this.addTsToPlaylist(file, playlistFile);
                    //         }
                    //     });
                    //     if(noFileFound == true) {
                    //         videoBackupChannel.publish({ type: "no-video-available" });
                    //     }else {
                    //         _this.writeToPlayList(playlistFile, "#EXT-X-ENDLIST");
                    //         videoBackupChannel.publish({ type: "play-recorded-video" });
                    //     }
                    // });

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
                _this.lastTimestamp = data.timestamp;
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

    isProcessOpenned(name) {
        ps.lookup({
            command: name,
        }, function(err, resultList ) {
            if (err) {
                throw new Error( err );
            }

            resultList.forEach(function( process ){
                if( process ){
                    console.log( 'PID: %s, COMMAND: %s, ARGUMENTS: %s', process.pid, process.command, process.arguments );
                    return true;
                }
            });

            return false;
        });
    }

}

new Worker();

