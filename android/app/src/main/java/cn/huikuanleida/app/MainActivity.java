package cn.huikuanleida.app;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.CapConfig;
import android.os.Bundle;
import android.webkit.WebView;
import android.widget.Toast;
import androidx.activity.OnBackPressedCallback;

public class MainActivity extends BridgeActivity {
    private boolean backPending;
    private int backRequestId;

    @Override public void onCreate(Bundle savedInstanceState) {
        if (BuildConfig.DEBUG && BuildConfig.RADAR_UI_TEST) {
            config = new CapConfig.Builder(this).setServerUrl("http://127.0.0.1:18765")
                .setWebContentsDebuggingEnabled(true).setLoggingEnabled(false).create();
        }
        registerPlugin(RadarFilesPlugin.class);
        super.onCreate(savedInstanceState);
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() {
                if (backPending || isFinishing() || isDestroyed()) return;
                WebView webView = getBridge().getWebView();
                if (!FileSavePolicy.allowsOrigin(webView.getUrl(), BuildConfig.DEBUG && BuildConfig.RADAR_UI_TEST)) {
                    fallback(this); return;
                }
                backPending = true;
                int requestId = ++backRequestId;
                Runnable timeout = () -> {
                    if (backPending && backRequestId == requestId) {
                        backPending = false;
                        ++backRequestId;
                        Toast.makeText(MainActivity.this, "页面响应较慢，请稍后重试", Toast.LENGTH_SHORT).show();
                    }
                };
                webView.postDelayed(timeout, 15000);
                webView.evaluateJavascript(
                    "(()=>{try{return typeof window.__radarHandleBack==='function'?window.__radarHandleBack():false;}catch(e){return null;}})()",
                    value -> {
                        if (backRequestId != requestId || isFinishing() || isDestroyed()) return;
                        webView.removeCallbacks(timeout);
                        backPending = false;
                        switch (BackNavigationPolicy.interpret(value)) {
                            case FALLBACK: fallback(this); break;
                            case STAY: Toast.makeText(MainActivity.this, "页面暂时无法处理返回，请稍后重试", Toast.LENGTH_SHORT).show(); break;
                            default: break;
                        }
                    }
                );
            }
        });
    }

    private void fallback(OnBackPressedCallback callback) {
        callback.setEnabled(false);
        try { getOnBackPressedDispatcher().onBackPressed(); }
        finally { callback.setEnabled(true); }
    }
}
