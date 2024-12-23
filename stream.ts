import { readdir } from 'fs/promises';

type VideoData = {
	id: string;
	data: Uint8Array[];
	clientID: string;
};

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
							VideoDatas.push({
								clientID: clientID,
								id: videoID,
								data: [],
							});
							break;
						case 'end':
							if (videoData) {
								const blob = new Blob(videoData.data, { type: 'video/webm' });
								const arrayBuffer = await blob.arrayBuffer();
								Bun.write(
									`./saves/${clientID}-${videoID}-${new Date().getTime()}.webm`,
									new Uint8Array(arrayBuffer),
								);
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
					videoData.data.push(uint8Array);
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

setInterval(() => {
	controlData.forEach((control) => {
		const currentHour = new Date().getHours();
		const currentMinute = new Date().getMinutes();
		const currentEvent = control.time.find(
			(time: { start: string; duration: number }) => {
				const [hour, minute] = time.start
					.split(':')
					.map((t: string) => parseInt(t));
				const duration = time.duration;
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
		}, currentEvent.duration * 60 * 1000);
	});
}, 60 * 1000);

console.log('Server started on port 8080');
