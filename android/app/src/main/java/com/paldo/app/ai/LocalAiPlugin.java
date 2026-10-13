package com.paldo.app.ai;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.OpenableColumns;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.*;
import com.getcapacitor.annotation.*;
import org.json.*;
import java.io.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;

@CapacitorPlugin(name="LocalAi")
public class LocalAiPlugin extends Plugin {
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private final NativeEngine engine=new NativeEngine();
    private final AtomicReference<Job> active=new AtomicReference<>();
    private volatile boolean loaded=false,foreground=true,destroyed=false;
    private ModelStore store;
    /** No usable bundle this launch (a dev build without it, or the copy failed): use what's already installed */
    private volatile boolean bundleMissing=false;
    private Runnable pendingImport;
    private CompletableFuture<JSObject> setupFuture;
    private volatile long setupBytes=0;
    private volatile String setupStage=null;
    private static final class Job {final String id;final AtomicBoolean cancelled=new AtomicBoolean();volatile boolean started=false,committed=false;Job(String id){this.id=id;}}
    @Override public void load(){
        if(Build.VERSION.SDK_INT>=26)try{store=new ModelStore(new File(getContext().getFilesDir(),"models"));}catch(IOException ignored){}
    }
    private boolean supported(){return Build.VERSION.SDK_INT>=26 && NativeEngine.available() && store!=null;}
    private JSObject snapshot() throws Exception {
        JSObject result=new JSObject();result.put("available",supported());result.put("loaded",loaded);result.put("architecture",Build.SUPPORTED_ABIS[0]);
        if(store!=null){ModelStore.Model selected=store.selected();if(selected!=null){JSObject model=new JSObject();model.put("name",store.name(selected.sha256));model.put("bytes",selected.bytes);model.put("sha256",selected.sha256);result.put("model",model);}}
        if(setupStage!=null){JSObject setup=new JSObject();setup.put("bytes",setupBytes);setup.put("total",BundledModel.BYTES);setup.put("stage",setupStage);result.put("setup",setup);}
        return result;
    }
    private void reject(PluginCall call,Exception error){
        String code=error instanceof ModelStore.Failure?((ModelStore.Failure)error).code:error.getMessage();
        if(code==null || !code.matches("MISSING_MODEL|UNSUPPORTED_ARCH|INVALID_MODEL|INSUFFICIENT_SPACE|BUSY|LOAD_FAILED|CANCELLED|PROMPT_TOO_LONG|INFERENCE_FAILED"))code="INFERENCE_FAILED";
        call.reject(code,code);
    }
    private Job begin(PluginCall call,String id){
        if(!supported()){call.reject("UNSUPPORTED_ARCH","UNSUPPORTED_ARCH");return null;}
        Job job=new Job(id);
        if(destroyed || !foreground){call.reject("CANCELLED","CANCELLED");return null;}
        if(!active.compareAndSet(null,job)){call.reject("BUSY","BUSY");return null;}
        return job;
    }
    private void check(Job job){if(job.cancelled.get() || destroyed || !foreground)throw new IllegalStateException("CANCELLED");}
    private long ensureLoaded(Job job) throws Exception {
        check(job);if(loaded)return 0;
        ModelStore.Model selected=store.selected();if(selected==null)throw new IllegalStateException("MISSING_MODEL");
        long started=System.nanoTime();engine.load(selected.file.getAbsolutePath());loaded=true;check(job);
        return (System.nanoTime()-started)/1_000_000;
    }
    @PluginMethod public void status(PluginCall call){try{call.resolve(snapshot());}catch(Exception e){reject(call,e);}}
    @PluginMethod public synchronized void setupModel(PluginCall call){
        if(setupFuture!=null && !setupFuture.isDone()){attachSetup(call,setupFuture);return;}
        // Done when this app's bundled model is in place, or when a dev build has no bundle and something was imported
        try{if(supported() && (store.has(BundledModel.SHA256) || (bundleMissing && store.selected()!=null))){call.resolve(snapshot());return;}}catch(Exception error){reject(call,error);return;}
        Job job=begin(call,"setup");if(job==null)return;job.started=true;
        CompletableFuture<JSObject> completion=new CompletableFuture<>();setupFuture=completion;attachSetup(call,completion);
        worker.execute(()->{
            JSObject result=null;Exception failure=null;
            try{
                check(job);engine.unload();loaded=false;
                new BundledModel(BundledModel.BYTES,BundledModel.SHA256).ensure(store,()->getContext().getAssets().open(BundledModel.ASSET),()->getContext().getFilesDir().getUsableSpace(),()->job.cancelled.get() || destroyed || !foreground,file->{try{engine.load(file.getAbsolutePath());}finally{engine.unload();loaded=false;}},activation->{synchronized(job){check(job);activation.run();job.committed=true;}},(copied,total)->{setupBytes=copied;setupStage=copied<total?"copying":"checking";});
                store.setName(BundledModel.SHA256,BundledModel.NAME);
                setupStage=null;result=snapshot();
            }catch(FileNotFoundException error){
                bundleMissing=true;
                try{if(store.selected()!=null)result=snapshot();else failure=new IllegalStateException("MISSING_MODEL");}catch(Exception e){failure=e;}
            }catch(Exception error){
                // A failed update copy (e.g. no room for the new bundle) keeps the model already here working; retried next launch
                String code=error instanceof ModelStore.Failure?((ModelStore.Failure)error).code:error.getMessage();
                try{if(!"CANCELLED".equals(code) && store.selected()!=null){bundleMissing=true;result=snapshot();}else failure=error;}catch(Exception e){failure=error;}
            }
            finally{setupStage=null;active.compareAndSet(job,null);}
            if(failure!=null)completion.completeExceptionally(failure);else completion.complete(result);
        });
    }
    private void attachSetup(PluginCall call,CompletableFuture<JSObject> completion){completion.whenComplete((result,error)->{if(error==null)call.resolve(result);else reject(call,error instanceof Exception?(Exception)error:new IllegalStateException("INFERENCE_FAILED"));});}
    @PluginMethod public void load(PluginCall call){
        Job job=begin(call,"load");if(job==null)return;
        worker.execute(()->{try{ensureLoaded(job);call.resolve(snapshot());}catch(Exception e){reject(call,e);}finally{active.compareAndSet(job,null);}});
    }
    @PluginMethod public void generate(PluginCall call){
        String id=call.getString("requestId","");JSArray messages=call.getArray("messages");Integer limit=call.getInt("maxTokens",256);
        if(!id.matches("[A-Za-z0-9_-]{1,80}") || messages==null || limit<1 || limit>256){call.reject("INFERENCE_FAILED","INFERENCE_FAILED");return;}
        String input=messages.toString();if(input.getBytes(java.nio.charset.StandardCharsets.UTF_8).length>65536){call.reject("PROMPT_TOO_LONG","PROMPT_TOO_LONG");return;}
        Job job=begin(call,id);if(job==null)return;
        worker.execute(()->{
            try{
                long loadMs=ensureLoaded(job);check(job);
                JSObject result=new JSObject(engine.generate(id,input,limit));check(job);result.put("loadMs",loadMs);
                ModelStore.Model selected=store.selected();if(selected!=null)result.put("model",store.name(selected.sha256));call.resolve(result);
            }catch(Exception e){reject(call,e);}finally{active.compareAndSet(job,null);}
        });
    }
    @PluginMethod public void cancel(PluginCall call){
        Job job=active.get();String id=call.getString("requestId","");
        if(job!=null && job.id.equals(id))cancelJob(job);
        call.resolve();
    }
    private void cancelJob(Job job){synchronized(job){if(!job.committed){job.cancelled.set(true);engine.cancel(job.id);}}}
    private void stop(){Job job=active.get();if(job!=null)cancelJob(job);worker.execute(()->{engine.unload();loaded=false;});}
    @PluginMethod public void unload(PluginCall call){stop();worker.execute(call::resolve);}
    @PluginMethod public void listModels(PluginCall call){
        if(!supported()){call.reject("UNSUPPORTED_ARCH","UNSUPPORTED_ARCH");return;}
        try{
            ModelStore.Model selected=store.selected();JSArray models=new JSArray();
            for(ModelStore.Model m:store.list()){JSObject model=new JSObject();model.put("name",store.name(m.sha256));model.put("bytes",m.bytes);model.put("sha256",m.sha256);model.put("selected",selected!=null && selected.sha256.equals(m.sha256));model.put("bundled",m.sha256.equals(BundledModel.SHA256));models.put(model);}
            JSObject result=new JSObject();result.put("models",models);call.resolve(result);
        }catch(Exception e){reject(call,e);}
    }
    /** Switch the answering model: unload now, the next message loads the new one */
    @PluginMethod public void selectModel(PluginCall call){
        String sha=call.getString("sha256","");Job job=begin(call,"select");if(job==null)return;
        worker.execute(()->{try{engine.unload();loaded=false;store.select(sha);call.resolve(snapshot());}catch(Exception e){reject(call,e);}finally{active.compareAndSet(job,null);}});
    }
    @PluginMethod public void removeModel(PluginCall call){
        String sha=call.getString("sha256","");Job job=begin(call,"remove");if(job==null)return;
        worker.execute(()->{try{store.remove(sha);call.resolve(snapshot());}catch(Exception e){reject(call,e);}finally{active.compareAndSet(job,null);}});
    }
    @PluginMethod public void importModel(PluginCall call){
        Job job=begin(call,"import");if(job==null)return;
        Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT);intent.addCategory(Intent.CATEGORY_OPENABLE);intent.setType("*/*");
        try{startActivityForResult(call,intent,"modelPicked");}catch(Exception e){active.compareAndSet(job,null);reject(call,e);}
    }
    @ActivityCallback private void modelPicked(PluginCall call,ActivityResult result){
        Job job=active.get();
        if(call==null){if(job!=null)active.compareAndSet(job,null);return;}
        if(job==null || result.getResultCode()!=Activity.RESULT_OK || result.getData()==null || result.getData().getData()==null){if(job!=null)active.compareAndSet(job,null);call.reject("CANCELLED","CANCELLED");return;}
        Uri uri=result.getData().getData();
        Runnable operation=()->{
            try{
                check(job);engine.unload();loaded=false;long bytes=-1;String name="Imported model";
                try(Cursor cursor=getContext().getContentResolver().query(uri,new String[]{OpenableColumns.SIZE,OpenableColumns.DISPLAY_NAME},null,null,null)){if(cursor!=null && cursor.moveToFirst()){if(!cursor.isNull(0))bytes=cursor.getLong(0);if(!cursor.isNull(1))name=cursor.getString(1).replaceAll("(?i)\\.gguf$","");}}
                try(InputStream input=getContext().getContentResolver().openInputStream(uri)){
                    if(input==null)throw new IllegalStateException("INVALID_MODEL");
                    ModelStore.Model imported=store.importStream(input,bytes,()->getContext().getFilesDir().getUsableSpace(),()->job.cancelled.get() || destroyed || !foreground,file->{try{engine.load(file.getAbsolutePath());}finally{engine.unload();loaded=false;}},activation->{synchronized(job){check(job);activation.run();job.committed=true;}});
                    store.setName(imported.sha256,name);
                }
                call.resolve(snapshot());
            }catch(Exception e){reject(call,e);}finally{active.compareAndSet(job,null);}
        };
        synchronized(this){if(foreground){job.started=true;worker.execute(operation);}else pendingImport=operation;}
    }
    @Override protected synchronized void handleOnPause(){Job job=active.get();if(job!=null){synchronized(job){foreground=false;if(!job.id.equals("import") || job.started)cancelJob(job);}}else foreground=false;worker.execute(()->{engine.unload();loaded=false;});}
    @Override protected synchronized void handleOnResume(){foreground=true;if(pendingImport!=null){Runnable operation=pendingImport;pendingImport=null;Job job=active.get();if(job!=null)job.started=true;worker.execute(operation);}}
    @Override protected synchronized void handleOnDestroy(){Job job=active.get();if(job!=null){synchronized(job){destroyed=true;cancelJob(job);}}else destroyed=true;stop();if(pendingImport!=null){worker.execute(pendingImport);pendingImport=null;}worker.shutdown();}
}
