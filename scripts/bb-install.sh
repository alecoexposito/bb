#!/usr/bin/env bash
cd ~
echo updateando repositorios
sudo apt update
sudo apt-get update
echo instalando python-pip
sudo apt-get install python-pip
echo instalando python setuptools
sudo pip install setuptools
echo instalando python pyserial
sudo pip install pyserial
echo instalando nodejs
curl -sL https://deb.nodesource.com/setup_10.x | sudo -E bash -
sudo apt-get install -y nodejs
echo instalando pm2
sudo npm install pm2@latest -g
echo clonando el proyecto
git clone https://github.com/alecoexposito/bb.git
cd ~/bb
echo corriendo npm install
npm install
echo creando carpetas necesarias
mkdir ~/camera
mkdir ~/camera-local
echo 0 > ~/camera-local/camera-1.jpg
mkdir ~/video-backup
mkdir ~/.db
echo copiando base de datos sqlite
cp ~/bb/data/bb.sqlite ~/.db
echo copiando scripts
cp ~/bb/scripts ~/ -r
sudo mkdir /usr/scripts
sudo cp ~/bb/scripts/* /usr/scripts
sudo chmod 777 /usr/scripts -R
echo instalando ffmpeg
sudo apt-get install sshfs ffmpeg
echo instalando gstreamer
sudo apt-get install gstreamer1.0-rtsp gstreamer1.0-tools gstreamer1.0-plugins-good gstreamer1.0-plugins-bad gstreamer1.0-plugins-ugly gstreamer1.0-libav

#echo instalando apache2
#sudo apt-get install apache2
