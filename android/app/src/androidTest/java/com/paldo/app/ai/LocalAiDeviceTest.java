package com.paldo.app.ai;

import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicLong;
import static org.junit.Assert.*;

public class LocalAiDeviceTest {
    @Test public void actualGenerationAndLifecycle() throws Exception {
        File root = new File(InstrumentationRegistry.getInstrumentation().getTargetContext().getFilesDir(), "models");
        ModelStore store = new ModelStore(root);
        assertNotNull("Install the verified Qwen model first", store.selected());
        NativeEngine engine = new NativeEngine();
        ScheduledExecutorService memorySampler=Executors.newSingleThreadScheduledExecutor();
        AtomicLong peakPssKb=new AtomicLong();
        memorySampler.scheduleAtFixedRate(()->peakPssKb.accumulateAndGet(android.os.Debug.getPss(),Math::max),0,250,TimeUnit.MILLISECONDS);
        try {
            long started=System.nanoTime(); engine.load(store.selected().file.getAbsolutePath());
            long loadMs=(System.nanoTime()-started)/1_000_000;
            String messages="[{\"role\":\"system\",\"content\":\"You help students plan schedules. Reply with one short sentence, at most 15 words. Return JSON text and action. Set action to an object with type none. Do not include arrays, plans or extra keys.\",\"required\":true,\"priority\":100},{\"role\":\"user\",\"content\":\"Hi! Help me plan today.\",\"required\":true,\"priority\":100}]";
            JSONObject result = new JSONObject(engine.generate("device-smoke", messages, 256));
            assertEquals("device-smoke", result.getString("requestId"));
            assertTrue(result.getInt("generatedTokens") <= 256);
            assertTrue(result.getInt("promptTokens") <= 3840);
            assertFalse(result.getString("text").isEmpty());
            new JSONObject(result.getString("text"));
            android.os.Bundle metrics=new android.os.Bundle();metrics.putString("stream","PALDO_METRICS loadMs="+loadMs+" firstTokenMs="+result.getLong("firstTokenMs")+" generationMs="+result.getLong("generationMs")+" generatedTokens="+result.getInt("generatedTokens")+" pssKb="+android.os.Debug.getPss()+" sampledPeakPssKb="+peakPssKb.get()+"\n");
            InstrumentationRegistry.getInstrumentation().sendStatus(0,metrics);
            String oversized="[{\"role\":\"user\",\"content\":\""+new String(new char[10000]).replace("\0","word ")+"\",\"required\":true}]";
            try{engine.generate("oversize",oversized,256);fail("Oversized mandatory content must reject");}catch(RuntimeException expected){assertTrue(expected.getMessage().contains("PROMPT_TOO_LONG"));}
            ExecutorService worker=Executors.newSingleThreadExecutor();
            try {
                Future<String> pending=worker.submit(() -> engine.generate("cancel-smoke", messages, 256));
                Thread.sleep(200); engine.cancel("unrelated-request");assertFalse(pending.isDone());
                try{engine.generate("overlap",messages,256);fail("Concurrent native generation must reject");}catch(RuntimeException expected){assertTrue(expected.getMessage().contains("BUSY"));}
                engine.cancel("cancel-smoke");
                try { pending.get(30,TimeUnit.SECONDS); fail("Cancellation must reject"); }
                catch (ExecutionException expected) {assertTrue(expected.getCause().getMessage().contains("CANCELLED"));}
            } finally {worker.shutdownNow();}
            for(int i=0;i<3;i++){engine.unload();engine.load(store.selected().file.getAbsolutePath());}
        } finally {memorySampler.shutdownNow();engine.unload();}
    }
    @Test public void missingModelReturnsError() {
        NativeEngine engine=new NativeEngine();
        try {engine.load("/data/local/tmp/no-paldo-model.gguf");fail();} catch (RuntimeException expected) {assertTrue(expected.getMessage().contains("LOAD_FAILED"));} finally {engine.unload();}
    }
    @Test public void invalidModelReturnsErrorWithoutCrashing() throws Exception {
        File file=File.createTempFile("invalid-native-",".gguf",InstrumentationRegistry.getInstrumentation().getTargetContext().getCacheDir());
        try(FileOutputStream output=new FileOutputStream(file)){output.write(new byte[32]);}
        NativeEngine engine=new NativeEngine();
        try{engine.load(file.getAbsolutePath());fail("Invalid model must reject");}catch(RuntimeException expected){assertTrue(expected.getMessage().contains("LOAD_FAILED"));}finally{engine.unload();file.delete();}
    }
}
