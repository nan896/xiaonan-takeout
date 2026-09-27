package com.waimai;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;

@SpringBootTest(properties = {
        "spring.datasource.url=jdbc:h2:mem:waimai-test;DB_CLOSE_DELAY=-1",
        "spring.sql.init.mode=always"
})
class WaimaiApplicationTests {

    @Test
    void contextLoads() {
    }
}
