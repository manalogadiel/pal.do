package com.paldo.app.ai;

import org.junit.Test;
import org.junit.Rule;
import org.junit.rules.TemporaryFolder;
import java.io.*;
import java.security.MessageDigest;
import java.util.concurrent.atomic.AtomicBoolean;
import static org.junit.Assert.*;

public class BundledModelTest {
    @Rule public TemporaryFolder temp=new TemporaryFolder();
    private byte[] valid(){byte[] bytes=new byte[1024];bytes[0]=71;bytes[1]=71;bytes[2]=85;bytes[3]=70;bytes[4]=3;return bytes;}
    private String hash(byte[] bytes)throws Exception{StringBuilder result=new StringBuilder();for(byte value:MessageDigest.getInstance("SHA-256").digest(bytes))result.append(String.format("%02x",value&255));return result.toString();}
    @Test public void freshSetupActivatesVerifiedBundle()throws Exception{
        byte[] bytes=valid();ModelStore store=new ModelStore(temp.newFolder());
        BundledModel bundle=new BundledModel(bytes.length,hash(bytes));
        ModelStore.Model installed=bundle.ensure(store,()->new ByteArrayInputStream(bytes),()->3L<<30,()->false,file->{},activation->activation.run(),(copied,total)->{});
        assertEquals(hash(bytes),installed.sha256);assertEquals(installed.sha256,store.selected().sha256);
    }
    @Test public void existingModelSkipsAssetCopyAndKeepsSelection()throws Exception{
        byte[] bytes=valid();ModelStore store=new ModelStore(temp.newFolder());ModelStore.Model prior=store.importStream(new ByteArrayInputStream(bytes),bytes.length,()->3L<<30,()->false,file->{});
        BundledModel bundle=new BundledModel(bytes.length,"0".repeat(64));
        ModelStore.Model result=bundle.ensure(store,()->{throw new AssertionError("Must not reopen bundled model");},()->0,()->false,file->{throw new AssertionError("Must not probe again");},activation->activation.run(),(copied,total)->{});
        assertEquals(prior.sha256,result.sha256);
    }
    @Test public void wrongChecksumCannotActivate()throws Exception{
        byte[] bytes=valid();ModelStore store=new ModelStore(temp.newFolder());
        try{new BundledModel(bytes.length,"0".repeat(64)).ensure(store,()->new ByteArrayInputStream(bytes),()->3L<<30,()->false,file->{},activation->activation.run(),(copied,total)->{});fail();}catch(ModelStore.Failure expected){assertEquals("INVALID_MODEL",expected.code);}
        assertNull(store.selected());assertEquals(0,store.directory.list().length);
    }
    @Test public void interruptedSetupCanRetryWithoutPartialActivation()throws Exception{
        byte[] bytes=valid();ModelStore store=new ModelStore(temp.newFolder());AtomicBoolean cancelled=new AtomicBoolean();BundledModel bundle=new BundledModel(bytes.length,hash(bytes));
        try{bundle.ensure(store,()->new ByteArrayInputStream(bytes),()->3L<<30,cancelled::get,file->{},activation->activation.run(),(copied,total)->{if(copied>0)cancelled.set(true);});fail();}catch(ModelStore.Failure expected){assertEquals("CANCELLED",expected.code);}
        assertNull(store.selected());assertEquals(0,store.directory.list().length);
        bundle.ensure(store,()->new ByteArrayInputStream(bytes),()->3L<<30,()->false,file->{},activation->activation.run(),(copied,total)->{});assertNotNull(store.selected());
    }
}
