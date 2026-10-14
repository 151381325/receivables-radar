package cn.huikuanleida.app;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.CapConfig;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle savedInstanceState) {
        if (BuildConfig.DEBUG && BuildConfig.RADAR_UI_TEST) {
            config = new CapConfig.Builder(this).setServerUrl("http://127.0.0.1:18765")
                .setWebContentsDebuggingEnabled(true).setLoggingEnabled(false).create();
        }
        registerPlugin(RadarFilesPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
