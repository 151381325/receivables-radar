package cn.huikuanleida.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.widget.TextView;
import androidx.appcompat.app.AppCompatActivity;

public class PrivacyConsentActivity extends AppCompatActivity {
    private static final String PREFERENCES_NAME = "privacy_preferences";
    private static final String CONSENT_VERSION_KEY = "privacy_consent_version";
    private static final String TERMS_URL = "https://huikuanleida.cn/terms/";
    private static final String PRIVACY_URL = "https://huikuanleida.cn/privacy/";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        String acceptedVersion = getSharedPreferences(PREFERENCES_NAME, MODE_PRIVATE)
            .getString(CONSENT_VERSION_KEY, null);
        if (PrivacyConsentState.isAccepted(acceptedVersion)) {
            openMainActivity();
            return;
        }

        setContentView(R.layout.activity_privacy_consent);
        findViewById(R.id.privacy_accept).setOnClickListener(view -> acceptAndContinue());
        findViewById(R.id.privacy_reject).setOnClickListener(view -> finishAffinity());
        setLink(R.id.privacy_terms_link, TERMS_URL);
        setLink(R.id.privacy_policy_link, PRIVACY_URL);
    }

    private void setLink(int viewId, String url) {
        TextView link = findViewById(viewId);
        link.setOnClickListener(view -> startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))));
    }

    private void acceptAndContinue() {
        getSharedPreferences(PREFERENCES_NAME, MODE_PRIVATE)
            .edit()
            .putString(CONSENT_VERSION_KEY, PrivacyConsentState.CURRENT_VERSION)
            .apply();
        openMainActivity();
    }

    private void openMainActivity() {
        startActivity(new Intent(this, MainActivity.class));
        finish();
    }
}
