package com.waimai;

import org.springframework.boot.CommandLineRunner;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.jdbc.core.JdbcTemplate;

@SpringBootApplication
public class WaimaiApplication {

    public static void main(String[] args) {
        SpringApplication.run(WaimaiApplication.class, args);
    }

    @Bean
    CommandLineRunner seedDishes(JdbcTemplate jdbc) {
        return args -> {
            Integer count = jdbc.queryForObject("SELECT COUNT(*) FROM dish", Integer.class);
            if (count != null && count > 0) {
                return;
            }

            String sql = """
                    INSERT INTO dish(name, category, description, price, image_url, available, sort_order)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """;

            jdbc.update(sql, "招牌红烧肉饭", "热销", "软糯红烧肉配时蔬和米饭", 28.00, "/images/dish-1.jpg", true, 1);
            jdbc.update(sql, "香辣鸡腿饭", "热销", "香煎鸡腿、土豆丝和溏心蛋", 25.00, "/images/dish-2.jpg", true, 2);
            jdbc.update(sql, "番茄牛腩面", "主食", "慢炖牛腩搭配酸甜番茄汤", 26.00, "/images/dish-3.jpg", true, 3);
            jdbc.update(sql, "鲜虾云吞面", "主食", "鲜虾云吞与清爽高汤", 22.00, "/images/dish-4.jpg", true, 4);
            jdbc.update(sql, "脆皮小酥肉", "小吃", "外酥里嫩，现点现炸", 16.00, "/images/dish-5.jpg", true, 5);
            jdbc.update(sql, "手作柠檬茶", "饮品", "清爽解腻，少糖也可备注", 10.00, "/images/dish-6.jpg", true, 6);
        };
    }
}
