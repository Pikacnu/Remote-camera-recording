import { readdir } from 'fs/promises';
import { $, type Subprocess } from 'bun';

type VideoData = {
	id: string;
	data: Uint8Array[];
	clientID: string;
	createdAt: number;
	ffmpeg: Subprocess;
};

const SAVE_PATH = './saves';

let VideoDatas: VideoData[] = [];
const heartbeatsTimeout = 10 * 1000;
const controlFiles = await readdir('./auto-control');
const controlData = await Promise.all(
	controlFiles.map(
		async (file) => await Bun.file(`./auto-control/${file}`).json(),
	),
);
console.log('read control data :', controlFiles.join(', '));

const server = Bun.serve<{
	type: string;
	data: any;
}>({
	fetch(request, server) {
		if (server.upgrade(request)) return;

		return new Response(Bun.file('./src/stream.html'));
	},

	port: 8080,
	reusePort: true,
	websocket: {
		sendPings: true,
		idleTimeout: 60,
		maxPayloadLength: 16 * 1024 * 1024,
		open(ws) {
			console.log('WebSocket opened');
			ws.send(
				JSON.stringify({
					type: 'heartbeat',
					data: heartbeatsTimeout,
				}),
			);
		},
		async message(ws, msg) {
			try {
				const data = JSON.parse(msg.toString());
				if (data.type === 'heartbeat') {
					ws.send(
						JSON.stringify({
							type: 'heartbeat',
							data: heartbeatsTimeout,
						}),
					);
					return;
				}
				const type = data.type;
				const clientID = data.clientID;
				const videoID = data.videoID;
				console.log(`from ${clientID} ${type}`);
				if (type === 'control') {
					if (videoID === '') return;
					const videoData = VideoDatas.find(
						(vd) => vd.clientID === clientID && vd.id === videoID,
					);
					switch (data.data) {
						case 'start':
							const createAt = new Date().getTime();
							VideoDatas.push({
								clientID: clientID,
								id: videoID,
								data: [],
								createdAt: createAt,
								ffmpeg: Bun.spawn(
									[
										'ffmpeg',
										'-i',
										'pipe:0',
										`${SAVE_PATH}/${clientID}-${videoID}-${createAt}.webm`,
									],
									{
										stdio: ['pipe', 'ignore', 'ignore'],
									},
								),
							});
							break;
						case 'end':
							if (videoData) {
								/*
								const blob = new Blob(videoData.data, { type: 'video/webm' });
								const arrayBuffer = await blob.arrayBuffer();
								const currentTime = new Date().getTime();
								await Bun.write(
									`./saves/${clientID}-${videoID}-${currentTime}.webm`,
									new Uint8Array(arrayBuffer),
								);*/
								if (typeof videoData.ffmpeg.stdin !== 'number') {
									videoData.ffmpeg.stdin?.end();
								}
							}
							VideoDatas = VideoDatas.filter(
								(vd) => vd.id !== videoID && vd.clientID !== clientID,
							);
							break;
						default:
							const control = controlData.find((cd) => cd.code === data.data);
							if (!control) return;
							ws.subscribe(`control-${control.id}`);
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
					/*
					videoData.data.push(uint8Array);
					*/
					if (typeof videoData.ffmpeg.stdin !== 'number') {
						videoData.ffmpeg.stdin?.write(uint8Array);
					}

					VideoDatas = VideoDatas.map((vd) =>
						vd.id === videoID ? videoData : vd,
					);
				}
			} catch (e) {
				console.error(e);
			}
		},
		close(ws) {
			console.log('WebSocket closed');
		},
	},
});

function contorl_Event() {
	controlData.forEach((control) => {
		const currentHour = new Date().getHours();
		const currentMinute = new Date().getMinutes();
		const currentEvent = control.time.find(
			(time: { start: string; duration: number }) => {
				const [hour, minute] = time.start
					.split(':')
					.map((t: string) => parseInt(t));
				if (currentHour === hour && currentMinute === minute) return true;
				return false;
			},
		);
		if (!currentEvent) return;
		server.publish(
			`control-${control.id}`,
			JSON.stringify({ type: 'control', name: control.id, data: 'start' }),
		);
		setTimeout(() => {
			server.publish(
				`control-${control.id}`,
				JSON.stringify({ type: 'control', name: control.id, data: 'end' }),
			);
		}, (currentEvent.duration + 1.5) * 60 * 1000);
	});
}

setInterval(() => {
	contorl_Event();
}, 60 * 1000);
setTimeout(() => {
	contorl_Event();
}, 1000);

console.log('Server started on port 8080');
