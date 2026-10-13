package com.paldo.app.ai;

import androidx.test.core.app.ActivityScenario;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.*;
import com.paldo.app.MainActivity;
import org.json.JSONObject;
import org.junit.Test;
import java.io.*;
import java.lang.reflect.Field;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;

public class BundledSetupDeviceTest {
    @Test public void freshPrivateStoreSetsUpFromApkWithoutDownload()throws Exception{
        android.content.Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
        try(android.content.res.AssetFileDescriptor asset=context.getAssets().openFd(BundledModel.ASSET)){assertEquals(BundledModel.BYTES,asset.getLength());}
        File directory=new File(context.getFilesDir(),"bundle-check-"+java.util.UUID.randomUUID());
        ModelStore scratch=new ModelStore(directory);AtomicReference<ModelStore> original=new AtomicReference<>();AtomicReference<LocalAiPlugin> pluginRef=new AtomicReference<>();
        CountDownLatch done=new CountDownLatch(1);AtomicReference<String> failure=new AtomicReference<>();
        PluginCall call=new PluginCall(null,"LocalAi","bundle-check","setupModel",new JSObject()){
            @Override public void resolve(JSObject result){done.countDown();}
            @Override public void reject(String message,String code){failure.set(code);done.countDown();}
        };
        NativeEngine engine=new NativeEngine();long started=System.nanoTime();
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)){
            Thread.sleep(1000);
            scenario.onActivity(activity->{try{
                LocalAiPlugin plugin=(LocalAiPlugin)activity.getBridge().getPlugin("LocalAi").getInstance();pluginRef.set(plugin);
                Field store=LocalAiPlugin.class.getDeclaredField("store");store.setAccessible(true);original.set((ModelStore)store.get(plugin));store.set(plugin,scratch);plugin.setupModel(call);
            }catch(Exception error){throw new RuntimeException(error);}});
            try {
                assertTrue("Bundled setup timed out",done.await(90,TimeUnit.SECONDS));assertNull(failure.get());
                ModelStore.Model model=scratch.selected();assertNotNull(model);assertEquals(BundledModel.SHA256,model.sha256);
                long setupMs=(System.nanoTime()-started)/1_000_000;
                engine.load(model.file.getAbsolutePath());
                JSONObject reply=new JSONObject(engine.generate("bundle-real", "[{\"role\":\"system\",\"content\":\"Reply in JSON with text and action. Say one short sentence of at most ten words. Set action type to none.\",\"required\":true},{\"role\":\"user\",\"content\":\"Hi\",\"required\":true}]",128));
                assertFalse(new JSONObject(reply.getString("text")).getString("text").isEmpty());engine.unload();
                CountDownLatch reused=new CountDownLatch(1);
                pluginRef.get().setupModel(new PluginCall(null,"LocalAi","bundle-reuse","setupModel",new JSObject()){
                    @Override public void resolve(JSObject result){reused.countDown();}
                    @Override public void reject(String message,String code){failure.set(code);reused.countDown();}
                });
                assertTrue(reused.await(3,TimeUnit.SECONDS));assertNull(failure.get());assertEquals(1,directory.list((d,n)->n.endsWith(".gguf")).length);assertTrue(new File(directory,"selected.properties").isFile());
                android.os.Bundle report=new android.os.Bundle();report.putString("stream","PALDO_BUNDLE pass fresh setup from APK, verified SHA, local generation, reuse; setupMs="+setupMs+"\n");InstrumentationRegistry.getInstrumentation().sendStatus(0,report);
            } finally {
                engine.unload();if(original.get()!=null)scenario.onActivity(activity->{try{Field store=LocalAiPlugin.class.getDeclaredField("store");store.setAccessible(true);store.set(pluginRef.get(),original.get());}catch(Exception error){throw new RuntimeException(error);}});
            }
        } finally {new File(directory,BundledModel.SHA256+".gguf").delete();new File(directory,"selected.properties").delete();directory.delete();}
    }
}
