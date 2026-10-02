import AsyncStorage from '@react-native-async-storage/async-storage';

export type NativeWorkspace = 'trade' | 'creditex';
const KEY = 'tlink.native-workspace.v1';
export async function readNativeWorkspace(): Promise<NativeWorkspace> {
  return await AsyncStorage.getItem(KEY) === 'creditex' ? 'creditex' : 'trade';
}
export async function saveNativeWorkspace(workspace: NativeWorkspace) {
  await AsyncStorage.setItem(KEY, workspace);
}
