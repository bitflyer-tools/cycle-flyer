import {Sources} from "./index";
import {Stream} from 'xstream';

export interface Actions {
    onExecutionCreated$: Stream<object>;
}

export const intent = (sources: Sources): Actions => {
    const onExecutionCreated$ = sources.pubnub.execution$;

    return { onExecutionCreated$ };
};
