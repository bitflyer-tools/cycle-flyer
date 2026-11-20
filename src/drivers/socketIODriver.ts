import { io, Socket } from "socket.io-client";
import Stream from "xstream";
import {BoardLevels} from "../models/board";
import {Execution} from "../models/execution";
import {ChildOrderEvent, ParentOrderEvent} from "../models/orderEvent";
import {authenticate, privateChannelNames} from "./privateChannel";

export const makeSocketIODriver = () => (): SocketIOSource => {
    const serverURL = "https://io.lightstream.bitflyer.com";
    const options = { transports: ["websocket"] };
    return new SocketIOSource(io(serverURL, options));
};

const productCode = "FX_BTC_JPY";

export class SocketIOSource {
    public board$: Stream<BoardLevels> = Stream.create();
    public ticker$: Stream<object> = Stream.create();
    public execution$: Stream<Execution> = Stream.create();
    public executionBatch$: Stream<Execution[]> = Stream.create();
    public childOrderEvent$: Stream<ChildOrderEvent> = Stream.create();
    public reconnect$: Stream<null> = Stream.create();
    public parentOrderEvent$: Stream<ParentOrderEvent> = Stream.create();

    private channels: { [channelName: string]: (message: any) => void } = {
        [`lightning_board_${productCode}`]: (message) => this.board$.shamefullySendNext(message),
        [`lightning_executions_${productCode}`]: (messages: Execution[]) => {
            this.executionBatch$.shamefullySendNext(messages);
            sendEach(this.execution$, messages);
        },
        child_order_events: (events) => sendEach(this.childOrderEvent$, events.filter(isTargetProduct)),
        parent_order_events: (events) => sendEach(this.parentOrderEvent$, events.filter(isTargetProduct)),
    };

    constructor(client: Socket) {
        const publicChannelNames = Object.keys(this.channels).filter((name) => privateChannelNames.indexOf(name) < 0);

        let connectedOnce = false;
        client.on("connect", () => {
            publicChannelNames.forEach((channelName) => client.emit("subscribe", channelName));
            authenticate(client, () => privateChannelNames.forEach((channelName) => client.emit("subscribe", channelName)));
            if (connectedOnce) { this.reconnect$.shamefullySendNext(null); }
            connectedOnce = true;
        });

        Object.keys(this.channels).forEach((channelName) => client.on(channelName, this.channels[channelName]));
    }
}

const sendEach = <T>(stream: Stream<T>, messages: T[]) =>
    messages.forEach((message) => stream.shamefullySendNext(message));

const isTargetProduct = (event: { product_code?: string }): boolean =>
    !event.product_code || event.product_code === productCode;
