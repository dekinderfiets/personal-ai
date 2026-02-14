#!/bin/bash

rsync -avz --delete -e "ssh -i ~/.ssh/contabo" ./ root@161.97.150.154:/root/n8n/ --exclude framework/sandbox --exclude framework/context --exclude collector/node_modules --exclude collector/ui/node_modules --exclude .git/