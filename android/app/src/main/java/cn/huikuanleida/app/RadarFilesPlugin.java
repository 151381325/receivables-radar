package cn.huikuanleida.app;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

@CapacitorPlugin(name = "RadarFiles")
public class RadarFilesPlugin extends Plugin {
    private boolean saving;

    @PluginMethod
    public void saveText(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (!FileSavePolicy.allowsOrigin(getBridge().getWebView().getUrl(), BuildConfig.DEBUG && BuildConfig.RADAR_UI_TEST)) {
                call.reject("当前页面不允许导出文件", "UNTRUSTED_ORIGIN"); return;
            }
            if (saving) { call.reject("请先完成当前保存", "SAVE_BUSY"); return; }
            try {
                String mime = call.getString("mimeType");
                String name = FileSavePolicy.validate(call.getString("filename"), call.getString("content"), mime);
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType(mime);
                intent.putExtra(Intent.EXTRA_TITLE, name);
                saving = true;
                startActivityForResult(call, intent, "fileCreated");
            } catch (IllegalArgumentException error) {
                saving = false; call.reject(error.getMessage(), "INVALID_FILE");
            } catch (Exception error) {
                saving = false; call.reject("无法打开系统保存窗口", "SAVE_UNAVAILABLE");
            }
        });
    }

    @ActivityCallback
    private void fileCreated(PluginCall call, ActivityResult result) {
        if (call == null) { saving = false; return; }
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            saving = false; call.reject("已取消保存", "SAVE_CANCELLED"); return;
        }
        Uri uri = result.getData().getData();
        // Write off the UI thread. No content or destination URI is logged.
        new Thread(() -> {
            try {
                FileSavePolicy.validate(call.getString("filename"), call.getString("content"), call.getString("mimeType"));
                try (OutputStream output = getContext().getContentResolver().openOutputStream(uri, "wt")) {
                    if (output == null) throw new java.io.IOException();
                    output.write(call.getString("content").getBytes(StandardCharsets.UTF_8));
                    output.flush();
                }
                call.resolve(new JSObject().put("saved", true));
            } catch (Exception error) {
                call.reject("文件保存失败，请重试或选择其他位置", "SAVE_FAILED");
            } finally {
                getActivity().runOnUiThread(() -> saving = false);
            }
        }, "radar-file-save").start();
    }
}
