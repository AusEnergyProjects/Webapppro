import path from 'node:path';
import { fileURLToPath } from 'node:url';
import metro from 'expo/metro-config.js';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const config = metro.getDefaultConfig(projectRoot);
// Shared domain logic and activity data live outside the Expo package.
config.watchFolders = [...config.watchFolders, path.resolve(projectRoot, '../src')];

export default config;
