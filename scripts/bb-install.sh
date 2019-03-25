#!/usr/bin/env bash
cd ~
echo instalando nodejs
curl -sL https://deb.nodesource.com/setup_9.x | sudo -E bash -
sudo apt-get install -y nodejs
echo instalando pm2
sudo npm install pm2@latest -g
echo clonando el proyecto
git clone https://github.com/alecoexposito/bb.git