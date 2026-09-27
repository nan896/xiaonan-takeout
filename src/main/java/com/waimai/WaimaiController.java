package com.waimai;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.sql.PreparedStatement;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.ThreadLocalRandom;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api")
public class WaimaiController {

    private static final List<String> ORDER_STATUSES =
            List.of("待接单", "制作中", "配送中", "已完成", "已取消");

    private final JdbcTemplate jdbc;
    private final NamedParameterJdbcTemplate namedJdbc;
    private final String adminPassword;
    private final String adminToken;

    public WaimaiController(
            JdbcTemplate jdbc,
            NamedParameterJdbcTemplate namedJdbc,
            @Value("${app.admin-password}") String adminPassword,
            @Value("${app.admin-token}") String adminToken
    ) {
        this.jdbc = jdbc;
        this.namedJdbc = namedJdbc;
        this.adminPassword = adminPassword;
        this.adminToken = adminToken;
    }

    @GetMapping("/shop/dishes")
    public List<Map<String, Object>> listShopDishes(
            @RequestParam(required = false) String keyword,
            @RequestParam(required = false) String category
    ) {
        StringBuilder sql = new StringBuilder("""
                SELECT id, name, category, description, price, image_url, available, sort_order
                FROM dish
                WHERE available = TRUE
                """);
        MapSqlParameterSource params = new MapSqlParameterSource();

        if (keyword != null && !keyword.isBlank()) {
            sql.append(" AND (LOWER(name) LIKE :keyword OR LOWER(description) LIKE :keyword)");
            params.addValue("keyword", "%" + keyword.trim().toLowerCase() + "%");
        }
        if (category != null && !category.isBlank() && !"全部".equals(category)) {
            sql.append(" AND category = :category");
            params.addValue("category", category.trim());
        }
        sql.append(" ORDER BY sort_order, id");
        return namedJdbc.query(sql.toString(), params, (rs, rowNum) -> dishRow(rs));
    }

    @GetMapping("/shop/categories")
    public List<String> listCategories() {
        return jdbc.queryForList(
                "SELECT DISTINCT category FROM dish WHERE available = TRUE ORDER BY category",
                String.class
        );
    }

    @PostMapping("/shop/orders")
    @Transactional
    public Map<String, Object> createOrder(@RequestBody CreateOrderRequest request) {
        validateOrder(request);

        Map<Long, Integer> quantityByDish = request.items().stream()
                .collect(Collectors.toMap(
                        OrderItemInput::dishId,
                        item -> Math.max(1, item.quantity()),
                        Integer::sum,
                        LinkedHashMap::new
                ));

        MapSqlParameterSource params = new MapSqlParameterSource("ids", quantityByDish.keySet());
        List<Map<String, Object>> dishes = namedJdbc.query("""
                SELECT id, name, price, available
                FROM dish
                WHERE id IN (:ids)
                """, params, (rs, rowNum) -> {
            Map<String, Object> dish = new LinkedHashMap<>();
            dish.put("id", rs.getLong("id"));
            dish.put("name", rs.getString("name"));
            dish.put("price", rs.getBigDecimal("price"));
            dish.put("available", rs.getBoolean("available"));
            return dish;
        });

        if (dishes.size() != quantityByDish.size()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "购物车中有菜品不存在");
        }

        BigDecimal total = BigDecimal.ZERO;
        List<Map<String, Object>> items = new ArrayList<>();
        for (Map<String, Object> dish : dishes) {
            if (!Boolean.TRUE.equals(dish.get("available"))) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, dish.get("name") + " 已下架");
            }
            long dishId = ((Number) dish.get("id")).longValue();
            int quantity = quantityByDish.get(dishId);
            BigDecimal price = (BigDecimal) dish.get("price");
            BigDecimal subtotal = price.multiply(BigDecimal.valueOf(quantity));
            total = total.add(subtotal);

            Map<String, Object> item = new LinkedHashMap<>();
            item.put("dishId", dishId);
            item.put("dishName", dish.get("name"));
            item.put("unitPrice", price);
            item.put("quantity", quantity);
            item.put("subtotal", subtotal);
            items.add(item);
        }

        String orderNo = createOrderNo();
        BigDecimal orderTotal = total;
        KeyHolder keyHolder = new GeneratedKeyHolder();
        jdbc.update(connection -> {
            PreparedStatement ps = connection.prepareStatement("""
                    INSERT INTO waimai_order(
                        order_no, customer_name, phone, address, remark, total_amount, status
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    """, new String[]{"id"});
            ps.setString(1, orderNo);
            ps.setString(2, request.customerName().trim());
            ps.setString(3, request.phone().trim());
            ps.setString(4, request.address().trim());
            ps.setString(5, blankToNull(request.remark()));
            ps.setBigDecimal(6, orderTotal);
            ps.setString(7, "待接单");
            return ps;
        }, keyHolder);

        long orderId = Objects.requireNonNull(keyHolder.getKey()).longValue();
        List<Object[]> batch = items.stream()
                .map(item -> new Object[]{
                        orderId,
                        item.get("dishId"),
                        item.get("dishName"),
                        item.get("unitPrice"),
                        item.get("quantity"),
                        item.get("subtotal")
                })
                .toList();
        jdbc.batchUpdate("""
                INSERT INTO order_item(order_id, dish_id, dish_name, unit_price, quantity, subtotal)
                VALUES (?, ?, ?, ?, ?, ?)
                """, batch);

        return Map.of(
                "orderId", orderId,
                "orderNo", orderNo,
                "totalAmount", total,
                "status", "待接单"
        );
    }

    @PostMapping("/admin/login")
    public Map<String, Object> adminLogin(@RequestBody AdminLoginRequest request) {
        if (!adminPassword.equals(request.password())) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "管理员密码错误");
        }
        return Map.of("token", adminToken, "message", "登录成功");
    }

    @GetMapping("/admin/summary")
    public Map<String, Object> summary(
            @RequestHeader(value = "X-Admin-Token", required = false) String token
    ) {
        requireAdmin(token);
        return Map.of(
                "dishCount", jdbc.queryForObject("SELECT COUNT(*) FROM dish", Integer.class),
                "orderCount", jdbc.queryForObject("SELECT COUNT(*) FROM waimai_order", Integer.class),
                "pendingCount", jdbc.queryForObject(
                        "SELECT COUNT(*) FROM waimai_order WHERE status = '待接单'", Integer.class),
                "todayRevenue", jdbc.queryForObject("""
                        SELECT COALESCE(SUM(total_amount), 0)
                        FROM waimai_order
                        WHERE status <> '已取消' AND CAST(created_at AS DATE) = CURRENT_DATE
                        """, BigDecimal.class)
        );
    }

    @GetMapping("/admin/orders")
    public List<Map<String, Object>> adminOrders(
            @RequestHeader(value = "X-Admin-Token", required = false) String token
    ) {
        requireAdmin(token);
        List<Map<String, Object>> orders = jdbc.query("""
                SELECT id, order_no, customer_name, phone, address, remark,
                       total_amount, status, created_at
                FROM waimai_order
                ORDER BY created_at DESC, id DESC
                """, (rs, rowNum) -> {
            Map<String, Object> order = new LinkedHashMap<>();
            order.put("id", rs.getLong("id"));
            order.put("orderNo", rs.getString("order_no"));
            order.put("customerName", rs.getString("customer_name"));
            order.put("phone", rs.getString("phone"));
            order.put("address", rs.getString("address"));
            order.put("remark", rs.getString("remark"));
            order.put("totalAmount", rs.getBigDecimal("total_amount"));
            order.put("status", rs.getString("status"));
            order.put("createdAt", rs.getTimestamp("created_at"));
            return order;
        });

        for (Map<String, Object> order : orders) {
            long orderId = ((Number) order.get("id")).longValue();
            order.put("items", jdbc.query("""
                    SELECT dish_name, unit_price, quantity, subtotal
                    FROM order_item
                    WHERE order_id = ?
                    ORDER BY id
                    """, (rs, rowNum) -> {
                Map<String, Object> item = new LinkedHashMap<>();
                item.put("dishName", rs.getString("dish_name"));
                item.put("unitPrice", rs.getBigDecimal("unit_price"));
                item.put("quantity", rs.getInt("quantity"));
                item.put("subtotal", rs.getBigDecimal("subtotal"));
                return item;
            }, orderId));
        }
        return orders;
    }

    @PatchMapping("/admin/orders/{id}/status")
    public Map<String, Object> updateOrderStatus(
            @PathVariable long id,
            @RequestHeader(value = "X-Admin-Token", required = false) String token,
            @RequestBody StatusRequest request
    ) {
        requireAdmin(token);
        if (request.status() == null || !ORDER_STATUSES.contains(request.status())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "订单状态不合法");
        }
        int updated = jdbc.update(
                "UPDATE waimai_order SET status = ? WHERE id = ?",
                request.status(), id
        );
        if (updated == 0) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "订单不存在");
        }
        return Map.of("message", "订单状态已更新", "status", request.status());
    }

    @GetMapping("/admin/dishes")
    public List<Map<String, Object>> adminDishes(
            @RequestHeader(value = "X-Admin-Token", required = false) String token
    ) {
        requireAdmin(token);
        return jdbc.query("""
                SELECT id, name, category, description, price, image_url, available, sort_order
                FROM dish
                ORDER BY sort_order, id
                """, (rs, rowNum) -> dishRow(rs));
    }

    @PostMapping("/admin/dishes")
    public Map<String, Object> createDish(
            @RequestHeader(value = "X-Admin-Token", required = false) String token,
            @RequestBody DishInput input
    ) {
        requireAdmin(token);
        validateDish(input);
        KeyHolder keyHolder = new GeneratedKeyHolder();
        jdbc.update(connection -> {
            PreparedStatement ps = connection.prepareStatement("""
                    INSERT INTO dish(
                        name, category, description, price, image_url, available, sort_order
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    """, new String[]{"id"});
            bindDish(ps, input);
            return ps;
        }, keyHolder);
        return Map.of("id", Objects.requireNonNull(keyHolder.getKey()).longValue());
    }

    @PutMapping("/admin/dishes/{id}")
    public Map<String, Object> updateDish(
            @PathVariable long id,
            @RequestHeader(value = "X-Admin-Token", required = false) String token,
            @RequestBody DishInput input
    ) {
        requireAdmin(token);
        validateDish(input);
        int updated = jdbc.update("""
                UPDATE dish
                SET name = ?, category = ?, description = ?, price = ?,
                    image_url = ?, available = ?, sort_order = ?
                WHERE id = ?
                """,
                input.name().trim(),
                input.category().trim(),
                blankToNull(input.description()),
                input.price(),
                blankToNull(input.imageUrl()),
                input.available() == null || input.available(),
                input.sortOrder() == null ? 0 : input.sortOrder(),
                id
        );
        if (updated == 0) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "菜品不存在");
        }
        return Map.of("message", "菜品已更新");
    }

    @DeleteMapping("/admin/dishes/{id}")
    public Map<String, Object> deleteDish(
            @PathVariable long id,
            @RequestHeader(value = "X-Admin-Token", required = false) String token
    ) {
        requireAdmin(token);
        int deleted = jdbc.update("DELETE FROM dish WHERE id = ?", id);
        if (deleted == 0) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "菜品不存在");
        }
        return Map.of("message", "菜品已删除");
    }

    private Map<String, Object> dishRow(java.sql.ResultSet rs) throws java.sql.SQLException {
        Map<String, Object> dish = new LinkedHashMap<>();
        dish.put("id", rs.getLong("id"));
        dish.put("name", rs.getString("name"));
        dish.put("category", rs.getString("category"));
        dish.put("description", rs.getString("description"));
        dish.put("price", rs.getBigDecimal("price"));
        dish.put("imageUrl", rs.getString("image_url"));
        dish.put("available", rs.getBoolean("available"));
        dish.put("sortOrder", rs.getInt("sort_order"));
        return dish;
    }

    private void requireAdmin(String token) {
        if (!adminToken.equals(token)) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "请先登录管理后台");
        }
    }

    private void validateOrder(CreateOrderRequest request) {
        if (request == null
                || request.customerName() == null || request.customerName().isBlank()
                || request.phone() == null || request.phone().isBlank()
                || request.address() == null || request.address().isBlank()
                || request.items() == null || request.items().isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "请完整填写姓名、手机、地址和菜品");
        }
        if (request.items().stream().anyMatch(item -> item.dishId() == null || item.quantity() == null)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "菜品数量不正确");
        }
    }

    private void validateDish(DishInput input) {
        if (input == null
                || input.name() == null || input.name().isBlank()
                || input.category() == null || input.category().isBlank()
                || input.price() == null || input.price().compareTo(BigDecimal.ZERO) <= 0) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "菜品名称、分类和正确价格不能为空");
        }
    }

    private void bindDish(PreparedStatement ps, DishInput input) throws java.sql.SQLException {
        ps.setString(1, input.name().trim());
        ps.setString(2, input.category().trim());
        ps.setString(3, blankToNull(input.description()));
        ps.setBigDecimal(4, input.price());
        ps.setString(5, blankToNull(input.imageUrl()));
        ps.setBoolean(6, input.available() == null || input.available());
        ps.setInt(7, input.sortOrder() == null ? 0 : input.sortOrder());
    }

    private String createOrderNo() {
        return "WM"
                + LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyyMMddHHmmss"))
                + ThreadLocalRandom.current().nextInt(100, 1000);
    }

    private String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    public record AdminLoginRequest(String password) {
    }

    public record CreateOrderRequest(
            String customerName,
            String phone,
            String address,
            String remark,
            List<OrderItemInput> items
    ) {
    }

    public record OrderItemInput(Long dishId, Integer quantity) {
    }

    public record StatusRequest(String status) {
    }

    public record DishInput(
            String name,
            String category,
            String description,
            BigDecimal price,
            String imageUrl,
            Boolean available,
            Integer sortOrder
    ) {
    }
}
