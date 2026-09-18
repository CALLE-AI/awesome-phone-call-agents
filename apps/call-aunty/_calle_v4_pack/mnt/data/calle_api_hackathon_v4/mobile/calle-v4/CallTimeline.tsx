import React from 'react';import {View,Text} from 'react-native';
export function CallTimeline({status}:{status:string}){const steps=['queued','in_progress','completed'];const idx=steps.indexOf(status);return <View>{steps.map((s,i)=><View key={s}><Text>{i<=idx?'●':'○'} {s}</Text></View>)}</View>}
