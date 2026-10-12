package com.paldo.app.ai;

import androidx.test.core.app.ActivityScenario;
import androidx.lifecycle.Lifecycle;
import androidx.test.platform.app.InstrumentationRegistry;
import com.paldo.app.MainActivity;
import org.json.*;
import org.junit.Test;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;

public class AppDeviceTest {
    private ActivityScenario<MainActivity> scenario;
    private String js(String script) throws Exception {
        CountDownLatch latch=new CountDownLatch(1);AtomicReference<String> result=new AtomicReference<>();
        scenario.onActivity(activity->activity.getBridge().getWebView().evaluateJavascript(script,value->{result.set(value);latch.countDown();}));
        assertTrue("WebView callback timed out",latch.await(10,TimeUnit.SECONDS));return result.get();
    }
    private void waitFor(String expression,int seconds) throws Exception {
        long until=System.nanoTime()+TimeUnit.SECONDS.toNanos(seconds);
        do{if("true".equals(js(expression)))return;Thread.sleep(150);}while(System.nanoTime()<until);
        fail("WebView condition timed out: "+expression);
    }
    private JSONObject state() throws Exception {return new JSONObject((String)new JSONTokener(js("localStorage.getItem('paldo-v1')")).nextValue());}
    private void submit(String text) throws Exception {
        js("(()=>{const t=document.querySelector('textarea[aria-label=Message]');t.focus();Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,"+JSONObject.quote(text)+");t.dispatchEvent(new Event('input',{bubbles:true}));return true})()");
        waitFor("!!document.querySelector('button[aria-label=Send]')",10);
        js("document.querySelector('button[aria-label=Send]').click()");
    }
    private void send(String text) throws Exception {
        report("PALDO_REPLAY sending: "+text);
        int before=state().getJSONArray("msgs").length();
        submit(text);
        waitFor("(()=>{const s=JSON.parse(localStorage.getItem('paldo-v1')||'{}');return s.msgs?.length>"+(before+1)+" && s.msgs.at(-1)?.from==='pal' && !document.querySelector('[role=status][aria-label*=thinking]')})()",150);
    }
    private JSONObject lastCard() throws Exception {
        JSONArray messages=state().getJSONArray("msgs");
        for(int i=messages.length()-1;i>=0;i--){JSONObject message=messages.getJSONObject(i);if(message.has("card"))return message.getJSONObject("card");}
        fail("No actual card was rendered");return null;
    }
    private void report(String text){android.os.Bundle data=new android.os.Bundle();data.putString("stream",text+"\n");InstrumentationRegistry.getInstrumentation().sendStatus(0,data);}
    private void fixture(String script) throws Exception {
        js("(()=>{"+script+";window.__fixtureRecreate=true;const put=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k!=='paldo-v1')put.call(this,k,v)}})()");
        scenario.recreate();waitFor("!window.__fixtureRecreate && !!document.querySelector('textarea[aria-label=Message]')",30);
    }
    private void offlineFixture() throws Exception {
        fixture("localStorage.setItem('paldo.ai-mode','offline');const base=new Date(2026,9,12,8,54).getTime();localStorage.setItem('paldo-v1',JSON.stringify({settings:{pal:'rei',name:'Rei',energy:'afternoon',onboarded:true,voiceOn:false,notify:false,notifyAsked:true,lastBrief:new Date().toDateString(),advancedMode:true},events:[],tasks:[],msgs:[],asked:[],alerted:[],log:{},offset:base-Date.now()}));localStorage.setItem('paldo.view','week')");

    }
    private void restore(String previous,String view,String mode) throws Exception {
        js("(()=>{for(const [k,v] of [['paldo-v1',"+previous+"],['paldo.view',"+view+"],['paldo.ai-mode',"+mode+"]]){if(v===null)localStorage.removeItem(k);else localStorage.setItem(k,v)}const put=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k!=='paldo-v1')put.call(this,k,v)}})()");
    }
    @Test public void reflowPreservesTotalStudyHours() throws Exception {
        scenario=ActivityScenario.launch(MainActivity.class);String previous=null,view=null,mode=null;
        try {
            waitFor("!!document.querySelector('#root')?.firstElementChild",30);
            previous=js("localStorage.getItem('paldo-v1')");view=js("localStorage.getItem('paldo.view')");mode=js("localStorage.getItem('paldo.ai-mode')");offlineFixture();
            fixture("const s=JSON.parse(localStorage.getItem('paldo-v1'));const day=new Date(2026,9,12).getTime();s.settings.notifyAsked=true;s.tasks=[{id:'four-hours',title:'App Dev exam',kind:'exam',due:day+32*3600000,hours:4,doneHours:0}];s.events=[0,1,2,3].map(i=>({id:'block-'+i,title:'App Dev review',kind:'work',status:'planned',taskId:'four-hours',start:day+(9+i)*3600000,end:day+(10+i)*3600000}));s.msgs=[{id:'overlap',from:'pal',text:'Seminar today 9-10am. Add and re-plan?',card:{type:'event',title:'Seminar',kind:'protected',start:day+9*3600000,end:day+10*3600000,conflicts:1}}];localStorage.setItem('paldo-v1',JSON.stringify(s))");

            assertEquals(4,state().getJSONArray("events").length());assertEquals(4,state().getJSONArray("tasks").getJSONObject(0).getInt("hours"));
            report("PALDO_REFLOW before "+js("JSON.stringify({offset:JSON.parse(localStorage.getItem('paldo-v1')).offset,cards:JSON.parse(localStorage.getItem('paldo-v1')).msgs.map(m=>m.card?.type)})"));
            js("(()=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Add and re-plan'||b.textContent.trim()==='Add anyway');if(!button)throw new Error('Missing overlap confirmation');button.click()})()");
            Thread.sleep(500);report("PALDO_REFLOW after "+js("JSON.stringify({tasks:JSON.parse(localStorage.getItem('paldo-v1')).tasks.map(t=>({id:t.id,hours:t.hours,done:t.doneHours})),events:JSON.parse(localStorage.getItem('paldo-v1')).events.map(e=>({id:e.id,status:e.status,kind:e.kind,task:e.taskId})),cards:JSON.parse(localStorage.getItem('paldo-v1')).msgs.map(m=>m.card?.type)})"));
            waitFor("JSON.parse(localStorage.getItem('paldo-v1')).msgs.some(m=>m.card?.type==='proposal')",15);
            JSONObject proposal=lastCard();assertEquals("proposal",proposal.getString("type"));assertEquals(4,proposal.getJSONObject("taskUpdate").getInt("hours"));
            js("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Accept').click()");
            waitFor("JSON.parse(localStorage.getItem('paldo-v1')).events.every(e=>e.status!=='proposed')",10);
            assertEquals(4,state().getJSONArray("tasks").getJSONObject(0).getInt("hours"));
            JSONArray events=state().getJSONArray("events");long studyMs=0;for(int i=0;i<events.length();i++){JSONObject event=events.getJSONObject(i);if(event.optString("taskId").equals("four-hours")&&event.getString("kind").equals("work")&&event.getString("status").equals("planned"))studyMs+=event.getLong("end")-event.getLong("start");}assertEquals(4*3600000L,studyMs);
            report("PALDO_REFLOW pass retained total 4 hours with 3 retained and 1 replacement");
        } finally {if(previous!=null)restore(previous,view,mode);scenario.close();}
    }
    @Test public void realModeAndBackgroundCancellation() throws Exception {
        scenario=ActivityScenario.launch(MainActivity.class);String previous=null,view=null,mode=null;
        try {
            waitFor("!!document.querySelector('#root')?.firstElementChild",30);
            previous=js("localStorage.getItem('paldo-v1')");view=js("localStorage.getItem('paldo.view')");mode=js("localStorage.getItem('paldo.ai-mode')");offlineFixture();
            for(int repeat=0;repeat<3;repeat++){
                for(boolean background:new boolean[]{false,true}){
                    js("(()=>{window.__nativeDone=false;window.__nativeStarted=false;const original=Capacitor.nativePromise;Capacitor.nativePromise=function(plugin,method,...rest){const result=original.call(this,plugin,method,...rest);if(plugin==='LocalAi'&&method==='generate'){window.__nativeStarted=true;result.finally(()=>window.__nativeDone=true).catch(()=>{})}return result}})()");
                    submit("Can you suggest a simple planning habit?");
                    waitFor("window.__nativeStarted && !!document.querySelector('button[aria-label=\"Cancel reply\"]')",10);
                    int count=state().getJSONArray("msgs").length();
                    if(background){scenario.moveToState(Lifecycle.State.CREATED);scenario.moveToState(Lifecycle.State.RESUMED);}
                    else js("(()=>{localStorage.setItem('paldo.ai-mode','online');dispatchEvent(new Event('paldo-ai-mode-change'))})()");
                    waitFor("window.__nativeDone===true",30);Thread.sleep(800);
                    assertEquals(count,state().getJSONArray("msgs").length());assertEquals(0,state().getJSONArray("events").length());
                    assertEquals("null",js("document.querySelector('button[aria-label=\"Cancel reply\"]')"));
                    js("(()=>{localStorage.setItem('paldo.ai-mode','offline');dispatchEvent(new Event('paldo-ai-mode-change'))})()");
                }
            }
            report("PALDO_LIFECYCLE pass mode/background cancellation 3 cycles each");
        } finally {if(previous!=null)restore(previous,view,mode);scenario.close();}
    }
    @Test public void airplaneModeLocalGenerationAndSchedule() throws Exception {
        assertEquals("Enable airplane mode on the phone first",1,android.provider.Settings.Global.getInt(InstrumentationRegistry.getInstrumentation().getTargetContext().getContentResolver(),android.provider.Settings.Global.AIRPLANE_MODE_ON,0));
        scenario=ActivityScenario.launch(MainActivity.class);String previous=null,view=null,mode=null;
        try {
            waitFor("!!document.querySelector('#root')?.firstElementChild",30);
            previous=js("localStorage.getItem('paldo-v1')");view=js("localStorage.getItem('paldo.view')");mode=js("localStorage.getItem('paldo.ai-mode')");offlineFixture();
            js("(()=>{window.__nativeOk=false;window.__fetchCalls=0;window.fetch=async()=>{window.__fetchCalls++;throw new Error('Offline acceptance forbids network')};const original=Capacitor.nativePromise;Capacitor.nativePromise=function(plugin,method,...rest){const result=original.call(this,plugin,method,...rest);if(plugin==='LocalAi'&&method==='generate')result.then(r=>{window.__nativeOk=!!r.text&&r.generatedTokens>0}).catch(()=>{});return result}})()");
            send("Can you suggest a simple planning habit?");assertEquals("true",js("window.__nativeOk"));assertEquals("0",js("window.__fetchCalls"));
            send("I have seminar today 3-5pm");JSONObject card=lastCard();assertEquals("event",card.getString("type"));assertEquals(1791788400000L,card.getLong("start"));send("yes");assertEquals(1,state().getJSONArray("events").length());
            report("PALDO_AIRPLANE pass real local generation, zero fetches, confirmed Seminar 3-5pm");
        } finally {if(previous!=null)restore(previous,view,mode);scenario.close();}
    }
    @Test public void offlineDailyBriefNeverFetchesWithNetworkAvailable() throws Exception {
        scenario=ActivityScenario.launch(MainActivity.class);String previous=null,view=null,mode=null,weather=null;
        try {
            waitFor("!!document.querySelector('#root')?.firstElementChild",30);
            previous=js("localStorage.getItem('paldo-v1')");view=js("localStorage.getItem('paldo.view')");mode=js("localStorage.getItem('paldo.ai-mode')");weather=js("localStorage.getItem('paldo.weather')");offlineFixture();
            fixture("const s=JSON.parse(localStorage.getItem('paldo-v1'));delete s.settings.lastBrief;localStorage.removeItem('paldo.weather');localStorage.setItem('paldo-v1',JSON.stringify(s))");
            js("(()=>{Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>true});Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition:success=>success({coords:{latitude:14.6,longitude:121}})}});window.__fetchCalls=0;window.fetch=async()=>{window.__fetchCalls++;throw new Error('Offline mode forbids fetch')}})()");
            Thread.sleep(7000);assertEquals("Offline startup must not fetch weather even with network available","0",js("window.__fetchCalls"));
            report("PALDO_OFFLINE_STARTUP pass no fetches with online navigator");
        } finally {if(previous!=null){restore(previous,view,mode);js("(()=>{const w="+weather+";if(w===null)localStorage.removeItem('paldo.weather');else localStorage.setItem('paldo.weather',w)})()");}scenario.close();}
    }
    @Test public void replaySchedulingCorrectionsThreeTimes() throws Exception {
        scenario=ActivityScenario.launch(MainActivity.class);
        String previous=null,previousView=null,previousMode=null;
        try{
            waitFor("!!document.querySelector('#root')?.firstElementChild",30);
            previous=js("localStorage.getItem('paldo-v1')");previousView=js("localStorage.getItem('paldo.view')");previousMode=js("localStorage.getItem('paldo.ai-mode')");
            for(int repeat=0;repeat<3;repeat++){
                fixture("const base=new Date(2026,9,12,8,54).getTime();localStorage.setItem('paldo-v1',JSON.stringify({settings:{pal:'rei',name:'Rei',energy:'afternoon',onboarded:true,voiceOn:false,notify:false,notifyAsked:true,lastBrief:new Date().toDateString(),advancedMode:true,userName:'Device Test'},events:[],tasks:[],msgs:[],asked:[],alerted:[],log:{},offset:base-Date.now(),conversation:{intent:'event',title:'App Dev exam',kind:'exam',day:new Date(2026,9,13).getTime(),rejected:[]}}));localStorage.setItem('paldo.view','week');return true");


                assertEquals("true",js("!!document.querySelector('button[aria-label=\"Switch to voice mode\"]')"));
                send("Hi jp");send("No, I want to schedule a new one");send("not an exam");send("no");send("I have seminar later");send("3-5pm");
                JSONObject seminar=lastCard();assertEquals("event",seminar.getString("type"));assertEquals("seminar",seminar.getString("title").toLowerCase());
                assertEquals(1791788400000L,seminar.getLong("start"));assertEquals(1791795600000L,seminar.getLong("end"));
                assertEquals(0,state().getJSONArray("events").length());send("yes");assertEquals(1,state().getJSONArray("events").length());
                send("App Dev exam tomorrow 4-6pm");JSONObject examCard=lastCard();assertEquals("event",examCard.getString("type"));
                assertEquals(1791878400000L,examCard.getLong("start"));assertEquals(1791885600000L,examCard.getLong("end"));send("yes");
                JSONArray events=state().getJSONArray("events");String examId="";for(int i=0;i<events.length();i++)if(events.getJSONObject(i).getString("kind").equals("exam"))examId=events.getJSONObject(i).getString("id");assertFalse(examId.isEmpty());
                send("2 hours of review before my App Dev exam");JSONObject proposal=lastCard();assertEquals("proposal",proposal.getString("type"));
                JSONArray ids=proposal.getJSONArray("blockIds"),all=state().getJSONArray("events");long duration=0;for(int i=0;i<all.length();i++){JSONObject block=all.getJSONObject(i);boolean included=false;for(int j=0;j<ids.length();j++)included|=ids.getString(j).equals(block.getString("id"));if(included){duration+=block.getLong("end")-block.getLong("start");assertTrue(block.getLong("end")<=1791878400000L);}}assertEquals(7200000L,duration);
                send("yes");send("remove those review sessions");assertEquals("change",lastCard().getString("type"));send("yes");
                JSONArray remaining=state().getJSONArray("events");assertEquals(2,remaining.length());boolean keptExam=false;for(int i=0;i<remaining.length();i++)keptExam|=remaining.getJSONObject(i).getString("id").equals(examId);assertTrue(keptExam);
                report("PALDO_REPLAY pass "+(repeat+1)+"/3 seminar/exam/review/removal");
            }
        } finally {
            if(previous!=null)restore(previous,previousView,previousMode);
            scenario.close();
        }
    }
}
