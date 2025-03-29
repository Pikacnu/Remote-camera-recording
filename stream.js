import { promises as fs } from 'fs';
import express from 'express';
import { WebSocketServer } from 'ws';
import { exec } from 'child_process';

const app = express();
const port = 8080;

let VideoDatas = [];
let Clients = [];
const heartbeatsTimeout = 10 * 1000;

const controlFiles = await fs.readdir('./auto-control');
const controlData = await Promise.all(
	controlFiles.map(async (file) => {
		const content = await fs.readFile(`./auto-control/${file}`, 'utf8');
		return JSON.parse(content);
	}),
);
console.log('read control data :', controlFiles.join(', '));

app.get('/', async (req, res) => {
	try {
		const content = await fs.readFile('./src/stream.html', 'utf8');
		res.send(content);
	} catch (error) {
		console.error('Error serving HTML:', error);
		res.status(500).send('Internal Server Error');
	}
});

const server = app.listen(port, () => {
	console.log(`Server started on port ${port}`);
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
	console.log('WebSocket opened');
	ws.send(JSON.stringify({ type: 'heartbeat', data: heartbeatsTimeout }));

	ws.on('message', async (message) => {
		try {
			const data = JSON.parse(message);
			if (data.type === 'heartbeat') {
				ws.send(JSON.stringify({ type: 'heartbeat', data: heartbeatsTimeout }));
				return;
			}
			const { type, clientID, videoID } = data;
			console.log(`from ${clientID} ${type}`);
			if (type === 'control') {
				if (videoID === '') return;
				const videoData = VideoDatas.find(
					(vd) => vd.clientID === clientID && vd.id === videoID,
				);
				switch (data.data) {
					case 'start':
						VideoDatas.push({ clientID, id: videoID, data: [] });
						break;
					case 'end':
						if (videoData) {
							const filePath = `P://saves/${clientID}-${videoID}.webm`;
							const mp4FilePath = filePath.replace('.webm', '.mp4');
							exec(
								`ffmpeg -i ${filePath} -c:v libx264 -c:a aac ${mp4FilePath}`,
								(error, stdout, stderr) => {
									if (error) {
										console.error(`Error converting file: ${error.message}`);
										return;
									}
									console.log(`File converted: ${mp4FilePath}`);
								},
							);
						}
						VideoDatas = VideoDatas.filter(
							(vd) => vd.id !== videoID && vd.clientID !== clientID,
						);
						break;
					default:
						const control = controlData.find((cd) => cd.code === data.data);
						if (!control) return;
						ws.send(
							JSON.stringify({
								type: 'control',
								name: control.id,
								data: 'taken',
							}),
						);
						break;
				}
			}
			if (type === 'data') {
				const videoData = VideoDatas.find(
					(vd) => vd.clientID === clientID && vd.id === videoID,
				);
				if (!videoData || !videoID) return;
				const uint8Array = new Uint8Array(Buffer.from(data.data, 'base64'));
				//const blob = new Blob([uint8Array], { type: 'video/webm' });
				//const arrayBuffer = await blob.arrayBuffer();
				const filePath = `P://saves/${clientID}-${videoID}.webm`;
				await fs.appendFile(filePath, uint8Array);
				//videoData.data.push(uint8Array);
				VideoDatas = VideoDatas.map((vd) =>
					vd.id === videoID ? videoData : vd,
				);
			}
		} catch (e) {
			console.error(e);
		}
	});

	ws.on('close', () => {
		console.log('WebSocket closed');
	});
});

function controlEvent() {
	controlData.forEach((control) => {
		const currentHour = new Date().getHours();
		const currentMinute = new Date().getMinutes();
		const currentEvent = control.time.find((time) => {
			const [hour, minute] = time.start.split(':').map((t) => parseInt(t));
			return currentHour === hour && currentMinute === minute;
		});
		if (!currentEvent) return;
		wss.clients.forEach((client) => {
			if (client.readyState === WebSocket.OPEN) {
				console.log(client);
				client.send(
					JSON.stringify({ type: 'control', name: control.id, data: 'start' }),
				);
			}
		});
		setTimeout(() => {
			wss.clients.forEach((client) => {
				if (client.readyState === WebSocket.OPEN) {
					client.send(
						JSON.stringify({ type: 'control', name: control.id, data: 'end' }),
					);
				}
			});
		}, (currentEvent.duration + 1.5) * 60 * 1000);
	});
}

setInterval(controlEvent, 60 * 1000);
setTimeout(controlEvent, 1000);
