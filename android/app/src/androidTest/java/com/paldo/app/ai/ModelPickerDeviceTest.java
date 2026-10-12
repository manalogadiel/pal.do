package com.paldo.app.ai;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;
import androidx.test.core.app.ActivityScenario;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.*;
import com.paldo.app.MainActivity;
import org.junit.Test;
import java.io.*;
import java.lang.reflect.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;

public class ModelPickerDeviceTest {
    @Test public void pickerResultWaitsForResumeAndInvalidImportKeepsModel() throws Exception {
        checkImport(false);
    }
    @Test public void validPickerResultActivatesModelAfterResume() throws Exception {
        checkImport(true);
    }
    private void checkImport(boolean valid) throws Exception {
        android.content.Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
        ModelStore store=new ModelStore(new File(context.getFilesDir(),"models"));
        ModelStore.Model prior=store.selected();assertNotNull(prior);
        File invalid=new File(context.getCacheDir(),"picker-invalid.gguf");
        if(valid)try{java.nio.file.Files.copy(prior.file.toPath(),invalid.toPath());}catch(Exception error){invalid.delete();throw error;}
        else try(FileOutputStream output=new FileOutputStream(invalid)){output.write(new byte[32]);}
        Uri uri=FileProvider.getUriForFile(context,context.getPackageName()+".fileprovider",invalid);
        CountDownLatch completed=new CountDownLatch(1);AtomicReference<String> code=new AtomicReference<>();
        PluginCall call=new PluginCall(null,"LocalAi","picker-regression","importModel",new JSObject()){
            @Override public void reject(String message,String failure){code.set(failure);completed.countDown();}
            @Override public void resolve(JSObject result){code.set("RESOLVED");completed.countDown();}
        };
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)){
            AtomicReference<LocalAiPlugin> pluginRef=new AtomicReference<>();
            scenario.onActivity(activity->{try{
                LocalAiPlugin plugin=(LocalAiPlugin)activity.getBridge().getPlugin("LocalAi").getInstance();pluginRef.set(plugin);
                Class<?> jobType=Class.forName("com.paldo.app.ai.LocalAiPlugin$Job");Constructor<?> constructor=jobType.getDeclaredConstructor(String.class);constructor.setAccessible(true);
                Field field=LocalAiPlugin.class.getDeclaredField("active");field.setAccessible(true);
                @SuppressWarnings("unchecked") AtomicReference<Object> active=(AtomicReference<Object>)field.get(plugin);assertTrue(active.compareAndSet(null,constructor.newInstance("import")));
                plugin.handleOnPause();
                Method picked=LocalAiPlugin.class.getDeclaredMethod("modelPicked",PluginCall.class,ActivityResult.class);picked.setAccessible(true);
                picked.invoke(plugin,call,new ActivityResult(Activity.RESULT_OK,new Intent().setData(uri)));
            }catch(Exception error){throw new RuntimeException(error);}});
            try {
                assertFalse("Picker result must wait for resume, not reject as background cancellation",completed.await(300,TimeUnit.MILLISECONDS));
                scenario.onActivity(activity->pluginRef.get().handleOnResume());
                assertTrue("Import must finish after resume",completed.await(30,TimeUnit.SECONDS));
                assertEquals(valid?"RESOLVED":"INVALID_MODEL",code.get());assertEquals(prior.sha256,store.selected().sha256);
            } finally {scenario.onActivity(activity->pluginRef.get().handleOnResume());}
        } finally {invalid.delete();}
    }
}
