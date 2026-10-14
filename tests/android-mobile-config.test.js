import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';

const readProjectFile = async (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Android 测试版使用固定应用标识并加载正式 HTTPS 站点', async () => {
  const config = JSON.parse(await readProjectFile('capacitor.config.json'));

  assert.equal(config.appId, 'cn.huikuanleida.app');
  assert.equal(config.appName, '回款雷达');
  assert.equal(config.webDir, 'dist');
  assert.equal(config.server.url, 'https://huikuanleida.cn');
  assert.equal(config.server.cleartext, false);
});

test('package scripts 提供 Android 同步和 Debug APK 构建入口', async () => {
  const packageJson = JSON.parse(await readProjectFile('package.json'));

  assert.equal(packageJson.scripts['android:sync'], 'npm run build && cap sync android');
  assert.equal(packageJson.scripts['android:build:debug'], 'npm run android:sync && cd android && gradlew.bat assembleDebug');
});

test('Gradle 允许 Windows 中文工作区路径', async () => {
  const properties = await readProjectFile('android/gradle.properties');

  assert.match(properties, /^android\.overridePathCheck=true$/m);
});

test('Android 正式版禁用系统备份并使用固定发布版本', async () => {
  const manifest = await readProjectFile('android/app/src/main/AndroidManifest.xml');
  const gradle = await readProjectFile('android/app/build.gradle');

  assert.match(manifest, /android:allowBackup="false"/);
  assert.match(gradle, /versionCode 2/);
  assert.match(gradle, /versionName "1\.0\.1"/);
});

test('Android 签名材料不会进入 Git', async () => {
  const gitignore = await readProjectFile('android/.gitignore');

  assert.match(gitignore, /^\*\.jks$/m);
  assert.match(gitignore, /^\*\.keystore$/m);
  assert.match(gitignore, /^keystore\.properties$/m);
});

test('Android 首次启动先展示隐私同意页', async () => {
  const manifest = await readProjectFile('android/app/src/main/AndroidManifest.xml');
  const privacyActivity = manifest.slice(
    manifest.indexOf('android:name=".PrivacyConsentActivity"'),
    manifest.indexOf('android:name=".MainActivity"'),
  );

  assert.match(
    manifest,
    /<activity[\s\S]*android:name="\.PrivacyConsentActivity"[\s\S]*android:exported="true"[\s\S]*android\.intent\.action\.MAIN[\s\S]*android\.intent\.category\.LAUNCHER[\s\S]*<\/activity>/,
  );
  assert.match(privacyActivity, /android:label="@string\/app_name"/);
  const mainActivity = manifest.slice(manifest.indexOf('android:name=".MainActivity"'));
  assert.match(mainActivity, /android:exported="false"/);
  assert.doesNotMatch(mainActivity.split('<provider')[0], /android\.intent\.category\.LAUNCHER/);
});

test('Android 隐私同意页提供明确选择和正式协议链接', async () => {
  const strings = await readProjectFile('android/app/src/main/res/values/strings.xml');
  const activity = await readProjectFile(
    'android/app/src/main/java/cn/huikuanleida/app/PrivacyConsentActivity.java',
  );

  assert.match(strings, />同意并继续</);
  assert.match(strings, />不同意并退出</);
  assert.match(activity, /https:\/\/huikuanleida\.cn\/terms\//);
  assert.match(activity, /https:\/\/huikuanleida\.cn\/privacy\//);
  assert.match(activity, /PrivacyConsentState\.CURRENT_VERSION/);
});

test('Android 正式图标使用已确认的橙色雷达品牌资源', async () => {
  const brandMark = await readProjectFile('android/app/src/main/res/drawable/ic_brand_mark.xml');
  const background = await readProjectFile(
    'android/app/src/main/res/values/ic_launcher_background.xml',
  );
  const foreground = await readProjectFile(
    'android/app/src/main/res/drawable-v24/ic_launcher_foreground.xml',
  );

  assert.match(brandMark, /#FFFFFF/);
  assert.match(brandMark, /android:strokeLineCap="round"/);
  assert.match(background, /#E84A0C/);
  assert.match(foreground, /@drawable\/ic_brand_mark/);

  const requiredPngs = [
    'android/app/src/main/res/mipmap-mdpi/ic_launcher.png',
    'android/app/src/main/res/mipmap-hdpi/ic_launcher_round.png',
    'android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.png',
    'android/app/src/main/res/drawable-port-xxxhdpi/splash.png',
    'android/app/src/main/res/drawable-land-xxxhdpi/splash.png',
  ];

  for (const path of requiredPngs) {
    assert.ok((await stat(new URL(`../${path}`, import.meta.url))).size > 0, `${path} 应存在`);
  }
});

test('Android Release 签名只从本地 keystore.properties 读取', async () => {
  const gradle = await readProjectFile('android/app/build.gradle');
  const example = await readProjectFile('android/keystore.properties.example');

  assert.match(gradle, /rootProject\.file\('keystore\.properties'\)/);
  assert.match(gradle, /signingConfigs\s*\{[\s\S]*release\s*\{/);
  assert.match(gradle, /signingConfig signingConfigs\.release/);
  for (const key of ['storeFile', 'storePassword', 'keyAlias', 'keyPassword']) {
    assert.match(gradle, new RegExp(`keystoreProperties\\['${key}'\\]`));
    assert.match(example, new RegExp(`^${key}=<[^>]+>$`, 'm'));
  }
  assert.doesNotMatch(example, /151381325|qq\.com|huikuanleida/i);
});
