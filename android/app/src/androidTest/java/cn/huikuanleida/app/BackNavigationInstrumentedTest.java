package cn.huikuanleida.app;

import androidx.lifecycle.Lifecycle;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import android.view.KeyEvent;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class BackNavigationInstrumentedTest {
    private void pressBack() {
        InstrumentationRegistry.getInstrumentation().sendKeyDownUpSync(KeyEvent.KEYCODE_BACK);
        InstrumentationRegistry.getInstrumentation().waitForIdleSync();
    }

    private String evaluate(ActivityScenario<MainActivity> scenario, String script) throws Exception {
        CountDownLatch done = new CountDownLatch(1);
        AtomicReference<String> output = new AtomicReference<>();
        scenario.onActivity(activity -> activity.getBridge().getWebView().evaluateJavascript(script, value -> {
            output.set(value); done.countDown();
        }));
        assertTrue("WebView response timeout", done.await(5, TimeUnit.SECONDS));
        return output.get();
    }

    private void fixture(ActivityScenario<MainActivity> scenario, String script) throws Exception {
        String html = "<!doctype html><html><body><dialog id='message'>Synthetic draft only</dialog><script>" + script + "</script></body></html>";
        scenario.onActivity(activity -> activity.getBridge().getWebView().loadDataWithBaseURL(
            "https://huikuanleida.cn/native-back-test", html, "text/html", "UTF-8", "https://huikuanleida.cn/native-back-test"));
        for (int attempt = 0; attempt < 60; attempt++) {
            if ("\"function\"".equals(evaluate(scenario, "typeof window.__radarHandleBack"))) {
                scenario.onActivity(activity -> {
                    assertTrue("Unexpected WebView URL: " + activity.getBridge().getWebView().getUrl(),
                        FileSavePolicy.allowsOrigin(activity.getBridge().getWebView().getUrl(), true));
                    assertTrue("Native back callback unavailable", activity.getOnBackPressedDispatcher().hasEnabledCallbacks());
                });
                assertEquals("Fixture must be resumed before testing back", Lifecycle.State.RESUMED, scenario.getState());
                return;
            }
            Thread.sleep(50);
        }
        fail("Synthetic page did not load");
    }

    @Test public void nativeBackClosesWebDialogThenAllowsRootExit() throws Exception {
        assertTrue("Only install/run these tests against the isolated UI-test package", BuildConfig.RADAR_UI_TEST);
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            fixture(scenario, "message.showModal();window.__radarHandleBack=()=>{if(message.open){message.close();return true;}return false;};");
            assertEquals("true", evaluate(scenario, "message.open"));
            pressBack();
            for (int attempt = 0; attempt < 60 && !"false".equals(evaluate(scenario, "message.open")); attempt++) Thread.sleep(50);
            assertEquals("false", evaluate(scenario, "message.open"));
            assertEquals(Lifecycle.State.RESUMED, scenario.getState());
            pressBack();
            for (int attempt = 0; attempt < 60 && scenario.getState() == Lifecycle.State.RESUMED; attempt++) Thread.sleep(50);
            assertNotEquals("Root back must no longer leave the activity in the foreground", Lifecycle.State.RESUMED, scenario.getState());
        }
    }

    @Test public void webScriptErrorDoesNotAccidentallyExit() throws Exception {
        assertTrue(BuildConfig.RADAR_UI_TEST);
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            fixture(scenario, "window.__radarHandleBack=()=>{throw new Error('synthetic failure');};");
            pressBack();
            // Synchronize with the JS queue after the native back evaluation.
            assertEquals("true", evaluate(scenario, "true"));
            assertEquals(Lifecycle.State.RESUMED, scenario.getState());
        }
    }
}
