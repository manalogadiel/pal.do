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
            assertEquals("74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db",selected.sha256);
        } finally {engine.unload();}
        assertTrue(inbox.delete());
    }
}
