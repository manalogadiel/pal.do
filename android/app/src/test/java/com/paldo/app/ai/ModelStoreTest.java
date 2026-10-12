package com.paldo.app.ai;

import org.junit.Test;
import org.junit.Rule;
import org.junit.rules.TemporaryFolder;
import java.io.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.Assert.*;

public class ModelStoreTest {
    @Rule public TemporaryFolder temp = new TemporaryFolder();
    private byte[] valid() { byte[] bytes = new byte[1024]; bytes[0]=71; bytes[1]=71; bytes[2]=85; bytes[3]=70; bytes[4]=3; return bytes; }
    private ModelStore store() throws Exception { return new ModelStore(temp.newFolder()); }
    private void expectError(String code, Throwing action) throws Exception {
        try { action.run(); fail("Expected " + code); } catch (ModelStore.Failure failure) { assertEquals(code, failure.code); }
    }
    interface Throwing { void run() throws Exception; }
    @Test public void successfulImportActivatesValidatedModel() throws Exception {
        ModelStore store = store();
        ModelStore.Model model = store.importStream(new ByteArrayInputStream(valid()), 1024, () -> 3L<<30, () -> false, file -> {});
        assertEquals(1024, model.bytes); assertEquals(64, model.sha256.length()); assertEquals(model.sha256, store.selected().sha256);
    }
    @Test public void cancelledImportKeepsPriorModel() throws Exception {
        ModelStore store = store(); ModelStore.Model prior = store.importStream(new ByteArrayInputStream(valid()), 1024, () -> 3L<<30, () -> false, file -> {});
        expectError("CANCELLED", () -> store.importStream(new ByteArrayInputStream(valid()), 1024, () -> 3L<<30, () -> true, file -> {}));
        assertEquals(prior.sha256, store.selected().sha256); assertEquals(2, store.directory.list().length);
    }
    @Test public void truncatedImportKeepsPriorModel() throws Exception {
        ModelStore store = store(); ModelStore.Model prior = store.importStream(new ByteArrayInputStream(valid()), 1024, () -> 3L<<30, () -> false, file -> {});
        expectError("INVALID_MODEL", () -> store.importStream(new ByteArrayInputStream(valid()), 2048, () -> 3L<<30, () -> false, file -> {}));
        assertEquals(prior.sha256, store.selected().sha256);
    }
    @Test public void oversizeRejectedBeforeReading() throws Exception {
        expectError("INVALID_MODEL", () -> store().importStream(new ByteArrayInputStream(valid()), (1L<<30)+1, () -> 4L<<30, () -> false, file -> {}));
    }
    @Test public void reserveCannotBeConsumed() throws Exception {
        expectError("INSUFFICIENT_SPACE", () -> store().importStream(new ByteArrayInputStream(valid()), 1024, () -> 1L<<30, () -> false, file -> {}));
    }
    @Test public void invalidMetadataPreservesSelection() throws Exception {
        ModelStore store = store(); ModelStore.Model prior = store.importStream(new ByteArrayInputStream(valid()), 1024, () -> 3L<<30, () -> false, file -> {});
        byte[] other = valid(); other[10]=1;
        expectError("INVALID_MODEL", () -> store.importStream(new ByteArrayInputStream(other), 1024, () -> 3L<<30, () -> false, file -> {throw new IOException("invalid tensors");}));
        assertEquals(prior.sha256, store.selected().sha256); assertEquals(2, store.directory.list().length);
    }
    @Test public void interruptedCopyPreservesSelection() throws Exception {
        ModelStore store = store(); ModelStore.Model prior = store.importStream(new ByteArrayInputStream(valid()), 1024, () -> 3L<<30, () -> false, file -> {});
        try { store.importStream(new InputStream(){public int read() throws IOException {throw new IOException("disconnected");}}, -1, () -> 3L<<30, () -> false, file -> {}); fail(); } catch (IOException expected) {}
        assertEquals(prior.sha256, store.selected().sha256); assertEquals(2, store.directory.list().length);
    }
    @Test public void cancellationAtActivationPreservesSelection() throws Exception {
        ModelStore store=store();ModelStore.Model prior=store.importStream(new ByteArrayInputStream(valid()),1024,()->3L<<30,()->false,file->{});
        byte[] replacement=valid();replacement[100]=1;AtomicInteger checks=new AtomicInteger();
        expectError("CANCELLED",()->store.importStream(new ByteArrayInputStream(replacement),1024,()->3L<<30,()->checks.incrementAndGet()>4,file->{}));
        assertEquals(prior.sha256,store.selected().sha256);assertTrue(prior.file.exists());assertEquals(2,store.directory.list().length);
    }
}
