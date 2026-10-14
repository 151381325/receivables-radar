// A browser download can only be started; Android must confirm a completed write.
export async function saveTextFile(filename, content, mimeType, platform = globalThis) {
  if (platform.Capacitor?.isNativePlatform?.()) {
    const files = platform.Capacitor.Plugins?.RadarFiles;
    if (!files?.saveText) throw new Error('请更新 APP 后使用文件导出，或在浏览器中导出备份');
    try {
      const result = await files.saveText({ filename, content, mimeType: mimeType.split(';')[0] });
      if (result?.saved !== true) throw new Error('文件尚未保存，请重试');
      return { status: 'saved' };
    } catch (error) {
      if (error.code === 'SAVE_CANCELLED') return { status: 'cancelled' };
      throw error;
    }
  }
  const url = platform.URL.createObjectURL(new platform.Blob([content], { type: mimeType }));
  const link = platform.document.createElement('a');
  link.href = url;
  link.download = filename;
  platform.document.body.append(link);
  link.click();
  link.remove();
  // Do not revoke before the browser has consumed the download URL.
  platform.setTimeout(() => platform.URL.revokeObjectURL(url), 60000);
  return { status: 'started' };
}
