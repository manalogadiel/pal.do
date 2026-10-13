package com.paldo.app.ai;

import androidx.test.platform.app.InstrumentationRegistry;
import java.io.*;
import org.junit.Test;
import static org.junit.Assert.*;

public class ModelSetupTest {
    @Test public void activateVerifiedTransfer() throws Exception {
        File root=new File(InstrumentationRegistry.getInstrumentation().getTargetContext().getFilesDir(),"models");
        ModelStore store=new ModelStore(root);File inbox=new File(root,"inbox.gguf");
        if(!inbox.isFile()){assertNotNull(store.selected());return;}
        NativeEngine engine=new NativeEngine();
        try(InputStream input=new FileInputStream(inbox)){
            ModelStore.Model selected=store.importStream(input,inbox.length(),root::getUsableSpace,()->false,file->{try{engine.load(file.getAbsolutePath());}finally{engine.unload();}});
            assertEquals("6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e",selected.sha256);
        } finally {engine.unload();}
        assertTrue(inbox.delete());
    }
}
