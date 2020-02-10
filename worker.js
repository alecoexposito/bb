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
var Client = require('node-rest-client').Client;

var socketClient = require('socketcluster-client');
var request = require('request')

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
        this.clientRest = new Client();
        this.autoplayCameras = [];
        this.autoplayCameraIntervals = [];
        this.intervalConnect = false;
        // this.clientSocketTracker = new net.Socket();
        // this.clientSocketTracker.connect(process.env.TRACKER_SOCKET_PORT, process.env.TRACKER_IP, function() {
        //     console.log("connected to tracker tcp socket");
        // });
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

    sendSingleImageWebsocket(channel, imei, name, vehicle, modifiedAt) {
        var _this = this;
        console.log("enviando single-image");
        let filePath = "/home/zurikato/camera-local/single-camera.jpg";
        let seconds = moment(modifiedAt).unix();
        let currentSeconds = moment().unix();
        let old = (currentSeconds - seconds) >= 10;
        try {
            var imageFile = fs.readFileSync(filePath);
            channel.publish({
                image: imageFile.toString("base64"),
                type: 'single-camera',
                imei: imei,
                name: name,
                vehicle: vehicle,
                old
            });
        } catch (e) {
            console.log("error reading file: ", e);
        }

    }

    async syncOfflineData(client) {
        var _this = this;
        let sql = "select * from info_data where is_offline = 1";
        let counter = 0;
        let toSend = [];
        _this.db.each(sql, [], async (err, row) => {
            if (err) {
                throw err;
            }
            // console.log("row: ", row);
            let response = {
                'device_id': row.device_id,
                'latitude': row.lat,
                'longitude': row.lng,
                'speed': row.speed,
                'createdAt': moment(Number.parseFloat(row.created_at)).format("YYYY-MM-DD HH:mm:ss"),
                'updatedAt': moment(Number.parseFloat(row.updated_at)).format("YYYY-MM-DD HH:mm:ss"),
                'track': row.orientation_plain
            };
            toSend.push(response);

        }, (err, count) => {
            if(err) {
                return console.log("error ocurred retrieving offline data from sqlite");
            }


        });
        await new Promise(r => setTimeout(r, 4000));
        var toSendNow = [];
        for (var i = 0; i < toSend.length; i++) {
            counter++;
            toSendNow.push(toSend[i]);
            if(counter == 5) {
                await new Promise(r => setTimeout(r, 600));
                let buffer = Buffer.from(JSON.stringify(toSendNow));
                client.write(buffer, function(err) {
                    if(err) {
                        console.log("error enviando el dato offline");
                    } else {
                        console.log("--------------------- enviado el dato offline -------------------------");
                    }
                });
                counter = 0;
                toSendNow = [];
            }
        }
        let buffer = Buffer.from(JSON.stringify(toSendNow));
        client.write(buffer, function(err) {
            if(err) {
                console.log("error enviando el dato offline");
            } else {
                console.log("--------------------- enviado el dato offline -------------------------");
            }
        });

        _this.db.run('update info_data set is_offline = 0 where is_offline = 1', [], function(err) {
            if(err) {
                return console.log(console.log(err.message));
            }

            console.log('updateados a 0 los datos offline sincronizados');
        });


    }

    loadAutoplayCameras() {
        console.log("load autoplay for cameras");
        var _this = this;
        this.clientRest.get(process.env.API_URL + "/devices/" + process.env.DEVICE_ID + "/camerasInAutoplay", function(data, response) {
            console.log("data in response: ", data);
            _this.autoplayCameras = data;
            while(_this.autoplayCameraIntervals.length > 0) {
                let interval = _this.autoplayCameraIntervals.pop();
                clearInterval(interval);
            }

            for (let i = 0; i < _this.autoplayCameras.length; i++) {
                let urlCamera = _this.autoplayCameras[i].url_camera;
                let cameraName = _this.autoplayCameras[i].name;
                let vehicle = _this.autoplayCameras[i].vehicle_name;
                let intervalSeconds = _this.autoplayCameras[i].autoplay_interval;

                let intervalC = setInterval(function() {
                    // var urlCamera = 'rtsp://192.168.1.30:554/user=admin&password=&channel=1&stream=1.sdp';
                    let singleCameraCommand = _this.runCommand('bash', [
                        '/home/zurikato/scripts/single-image.sh',
                        urlCamera
                    ]);
                    console.log("en el ciclo")
                    setTimeout(function() {
                        let statsOld = fs.statSync(path)
                        let singleImagelastModified = stats.mtime;

                        _this.sendSingleImageWebsocket(_this.cameraSingleChannel, process.env.DEVICE_IMEI, cameraName, vehicle, singleImagelastModified);
                    }, 4000)
                }, intervalSeconds * 1000);
                _this.autoplayCameraIntervals.push(intervalC);
            }
        });

    }
    connect() {
        // this.client = new net.Socket();
        // this.client.connect({
        //     port: 3002,
        //     host: process.env.TRACKER_IP
        // });
        this.socket = socketClient.connect(this.options);
    }

    launchIntervalConnect() {
        if(false != this.intervalConnect)
            return;
        this.intervalConnect = setInterval(this.connect, 5000)
    }

    clearIntervalConnect() {
        if(false == this.intervalConnect)
            return;
        clearInterval(this.intervalConnect)
        this.intervalConnect = false
    }


    run() {
        var _this = this;
        console.log('   >> Worker PID:', process.pid);
        var scServer = this.scServer;
        var bb = require(__dirname + '/BBCtrl')(SerialPort, nmea, net, fs, Readline, scServer);
        // var optionsClient = {'serialPort': '/dev/ttyS1', 'baudRate': 9600, 'port': 3002, 'ipAddress': process.env.TRACKER_IP};
        var optionsClient = {'serialPort': '/dev/ttyUSB1', 'baudRate': 9600, 'port': 3002, 'ipAddress': process.env.TRACKER_IP};
        this.client = new net.Socket();
        // client.on('error', function (err) {
        //     console.log('error conectandose al tracker: ', err);
        //     // setTimeout(function() {
        //     //     console.log("intentando conectarse al tracker again");
        //     //     client.connect(optionsClient.port, optionsClient.ipAddress, function () {
        //     //         console.log('----------------------------- CLIENT CONNECTED ------------------------------');
        //     //         // _this.syncOfflineData(client);
        //     //
        //     //     });
        //     // }, 10000)
        // });
        var options = {
            secure: false,
            hostname: process.env.TRACKER_IP,
            port: 3001,
            autoReconnect: true
        };
        this.options = options;
        // this.client = new net.Socket();
        // this.client.on('connect', () => {
        //     this.clearIntervalConnect()
        //     console.log('----------------------------- CLIENT NEWLY CONNECTED ------------------------------');
        //     this.client.setNoDelay(true);
        //     this.syncOfflineData(client);
        //
        // });

        //
        // this.client.on('error', (err) => {
        //
        //     this.launchIntervalConnect();
        // });

        // this.client.on('close', this.launchIntervalConnect);
        // this.client.on('end', this.launchIntervalConnect);


        // this.connect();

        bb.run(optionsClient, this.client, _this.db);
        scServer.on('connection', function (socket) {
            console.log("on connection: ", socket);
        });



        // this.socket = socketClient.connect(options);
        _this.connect();
        _this.socket.on('connect', function () {
            console.log("conectado al server websocket del tracker");
            // client.connect(optionsClient.port, optionsClient.ipAddress, function () {
            console.log('----------------------------- CLIENT CONNECTED ------------------------------');
            _this.clearIntervalConnect();
            _this.client.setNoDelay(true);
            // _this.syncOfflineData(_this.client);

            // });
        });

        _this.socket.on('error', function(err) {
            console.log("error ocurred: ", err);
            // socket = socketClient.connect(options);
        });

        _this.socket.on('close', function() {
            console.log("on close: ");
            _this.socket.removeAllListeners();
            _this.launchIntervalConnect();
            // socket = socketClient.connect(options);
        });


        var cameraChannel = this.socket.subscribe('camera_channel');
        var cameraVideoChannel = this.socket.subscribe('camera_' + process.env.DEVICE_ID + '_channel');
        _this.cameraSingleChannel = this.socket.subscribe('camera_single_channel');
        _this.cameraSingleChannel.watch(function(data) {
            if(data.type == "load-camera-autoplay") {
                _this.loadAutoplayCameras();
            }
        })


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

                } else if(data.type == "start-video-backup") {
                    var location = process.env.VIDEO_BACKUP_LOCATION + "/" + data.idCamera;
                    console.log("Stream from backup: ", data);
                    var initialDate = data.initialDate;
                    var endDate = data.endDate;
                    console.log(initialDate);

                    var videoBackupChannel = socket.subscribe(data.playlistName + '_channel');
                    let backupTrackerChannel = socket.subscribe("video_backup_channel");

                    var playlistFolder = "/home/zurikato/camera/video/" + data.playlistName;
                    var playlistFile = "/home/zurikato/camera/video/" + data.playlistName + "/playlist.m3u8";
                    // _this.initPlayList(playlistFile, playlistFolder);

                    var count = 1;
                    var playlistSize = 0;
                    playlistSize =  _this.getFilesizeInBytes(location + '/playlist.m3u8');
                    var lineReader = lr.createInterface({
                        input: fs.createReadStream(location + '/playlist.m3u8')
                    });

                    var lastUtilityLine = "";
                    var noFileFound = true;
                    var arrayInfo = [];
                    var infoCounter = 0;
                    lineReader.on('line', function (line) {
                        console.log("line read: ", line);
                        if(line.startsWith("#")) {
                            lastUtilityLine = line;
                        } else {
                            if(line >= initialDate && line <= endDate) {
                                console.log("line added: ", line);
                                noFileFound = false;

                                let dataToStore = {
                                    type: 'backup-file',
                                    fileName: line,
                                    deviceId: process.env.DEVICE_ID,
                                    playlist: data.playlistName,
                                    lastUtilityLine: lastUtilityLine
                                };
                                infoCounter++;
                                if(infoCounter >= 5 && playlistSize > 10000) {
                                    let backupToSend = arrayInfo;
                                    _this.sendRecordingsToServer(backupToSend, backupTrackerChannel, location, 100);
                                    infoCounter = 0;
                                    arrayInfo = [];
                                    playlistSize = 0;
                                }

                                arrayInfo.push(dataToStore);

                                // _this.addTsToPlaylist(line, playlistFile, lastUtilityLine);
                            } else if(line > endDate) {
                                console.log("ultima linea leida");
                                lineReader.close();
                            }
                        }

                    });

                    lineReader.on('close', async function() {
                        console.log("process finished");
                        if(noFileFound == true) {
                            videoBackupChannel.publish({ type: "no-video-available" });
                        }else {
                            let backupToSend = arrayInfo;
                            let endObj = {
                                type: "end-playlist",
                                deviceId: process.env.DEVICE_ID,
                                playlist: data.playlistName,
                            }
                            _this.sendRecordingsToServer(arrayInfo, backupTrackerChannel, location, 200,  endObj);
                            infoCounter = 0;
                            arrayInfo = [];

                            // backupTrackerChannel.publish({
                            //     type: "end-playlist",
                            //     deviceId: process.env.DEVICE_ID,
                            //     playlist: data.playlistName,
                            // });
                            // // _this.writeToPlayList(playlistFile, "#EXT-X-ENDLIST");
                            // videoBackupChannel.publish({
                            //     type: "play-recorded-video",
                            // });
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
                    let backupTrackerChannel = socket.subscribe("video_backup_channel");
                    backupTrackerChannel.publish({
                        type: 'download-video',
                        initialTime: data.initialTime,
                        totalTime: data.totalTime,
                        playlist: data.playlistName,
                        deviceId: process.env.DEVICE_ID
                    });

                    // _this.downloadVideoByTime(data.initialTime, totalTime, data.playlistName, socket);
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
        this.loadAutoplayCameras();

        var vpnChannel = this.socket.subscribe('vpn_' + process.env.DEVICE_ID + '_channel');
        vpnChannel.watch(function(data) {
            console.log("canal vpn: ", data);
            _this.runCommand('sudo', [
                'service',
                'openvpn',
                'start',
            ]);
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

    sendToServer(data, channel, location) {
        var dataToSend = data;

        request.post({
            url: process.env.API_URL + '/upload-ts-file',
            formData: {
                file: fs.createReadStream(location + "/" + data.fileName),
                filename: data.fileName,
                deviceId: data.deviceId,
                playlist: data.playlist
            }
        }, function(error, response, body) {
            // console.log(body);
        });

        console.log("########### PUBLICANDO EN EL BACKUP CHANNEL: ############", dataToSend);
        channel.publish(dataToSend);
    }

    async sendRecordingsToServer(dataArray, channel, location, delay, endData) {
        for (var i = 0; i < dataArray.length; i++) {
            await new Promise(r => setTimeout(r, delay));
            this.sendToServer(dataArray[i], channel, location);
        }
        if (endData) {
            channel.publish(endData);
            await new Promise(r => setTimeout(r, 100));
            channel.publish({
                type: "play-recorded-video",
            });
        }
    }

    getFilesizeInBytes(filename) {
        var stats = fs.statSync(filename)
        var fileSizeInBytes = stats["size"]
        return fileSizeInBytes
    }
}

new Worker();

