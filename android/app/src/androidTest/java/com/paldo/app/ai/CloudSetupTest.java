package com.paldo.app.ai;

import androidx.test.core.app.ActivityScenario;
import androidx.test.platform.app.InstrumentationRegistry;
import com.paldo.app.MainActivity;
import org.json.*;
import org.junit.Test;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;

public class CloudSetupTest {
    private ActivityScenario<MainActivity> scenario;
    private String js(String script) throws Exception {
        CountDownLatch latch=new CountDownLatch(1);AtomicReference<String> value=new AtomicReference<>();
        scenario.onActivity(activity->activity.getBridge().getWebView().evaluateJavascript(script,result->{value.set(result);latch.countDown();}));
        assertTrue(latch.await(10,TimeUnit.SECONDS));return value.get();
    }
    private void waitFor(String expression,int seconds) throws Exception {
        long until=System.nanoTime()+TimeUnit.SECONDS.toNanos(seconds);
        do{if("true".equals(js(expression)))return;Thread.sleep(150);}while(System.nanoTime()<until);
        fail("Cloud setup UI check timed out");
    }
    @Test public void configurePrivateKeyAndCheckCloud() throws Exception {
        File file=new File(InstrumentationRegistry.getInstrumentation().getTargetContext().getFilesDir(),"online-key.tmp");
        assertTrue("Transfer runtime configuration first",file.isFile());
        String key=new String(Files.readAllBytes(file.toPath()),StandardCharsets.UTF_8).trim();assertTrue(key.startsWith("gsk_"));assertTrue(file.delete());
        scenario=ActivityScenario.launch(MainActivity.class);String previous=null,view=null;
        try{
            waitFor("!!document.querySelector('#root')?.firstElementChild",30);
            previous=js("localStorage.getItem('paldo-v1')");view=js("localStorage.getItem('paldo.view')");
            js("(()=>{localStorage.setItem('paldo_groq_api_key',"+JSONObject.quote(key)+");localStorage.removeItem('paldo_groq_off');localStorage.setItem('paldo.ai-mode','online');localStorage.setItem('paldo-v1',JSON.stringify({settings:{pal:'rei',name:'Rei',energy:'afternoon',onboarded:true,voiceOn:false,notify:false,notifyAsked:false,advancedMode:true},events:[],tasks:[],msgs:[],asked:[],alerted:[],log:{},offset:0}));localStorage.setItem('paldo.view','week');})()");
            key=null;
            scenario.recreate();
            waitFor("!!document.querySelector('textarea[aria-label=Message]')",30);
            js("(()=>{window.__cloudAudit=[];const original=window.fetch;window.fetch=async(...args)=>{const r=await original(...args);if(String(args[0]).includes('api.groq.com'))window.__cloudAudit.push({status:r.status,model:JSON.parse(args[1].body).model});return r};const t=document.querySelector('textarea[aria-label=Message]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,'Can you suggest a simple planning habit?');t.dispatchEvent(new Event('input',{bubbles:true}))})()");
            waitFor("!!document.querySelector('button[aria-label=Send]')",10);js("document.querySelector('button[aria-label=Send]').click()");
            waitFor("window.__cloudAudit?.some(a=>a.status===200) && JSON.parse(localStorage.getItem('paldo-v1')).msgs.at(-1)?.from==='pal' && !document.querySelector('[role=status][aria-label*=thinking]')",60);
            android.os.Bundle metrics=new android.os.Bundle();metrics.putString("stream","PALDO_CLOUD "+js("JSON.stringify(window.__cloudAudit)")+"\n");InstrumentationRegistry.getInstrumentation().sendStatus(0,metrics);
        } finally {
            if(previous!=null){js("(()=>{const s="+previous+";if(s===null)localStorage.removeItem('paldo-v1');else localStorage.setItem('paldo-v1',s);const v="+view+";if(v===null)localStorage.removeItem('paldo.view');else localStorage.setItem('paldo.view',v);localStorage.setItem('paldo.ai-mode','offline');})()");}
            scenario.close();
        }
    }
}
