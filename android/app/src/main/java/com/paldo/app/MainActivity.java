package com.paldo.app;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;
import com.paldo.app.ai.LocalAiPlugin;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle savedInstanceState) {
        registerPlugin(LocalAiPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
