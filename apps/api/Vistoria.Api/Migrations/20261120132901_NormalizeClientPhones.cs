using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Vistoria.Api.Migrations
{
    /// <inheritdoc />
    public partial class NormalizeClientPhones : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // O telefone passa a ser só dígitos (ADR 0063). O que vira canônico, pela mesma regra do [Telefone], é
            // gravado assim: tira os separadores comuns e o 55 do país que sobra, e confere DDD e fixo ou celular. O
            // resto fica como está, nunca apagado; o próximo PUT dele cai no 400 do campo. A lista de DDDs é a de hoje,
            // copiada: a migração não muda se a regra mudar depois. O UPDATE sobe o rowversion só das linhas que mudam,
            // e o delta as reenvia aos aparelhos.
            migrationBuilder.Sql(
                """
                UPDATE c
                SET c.Phone = n.Canonical
                FROM clients AS c
                CROSS APPLY (SELECT REPLACE(TRANSLATE(c.Phone, '()-.+/', '      '), ' ', '') AS Digits) AS d
                CROSS APPLY (
                    SELECT CASE
                        WHEN LEN(d.Digits) IN (12, 13) AND LEFT(d.Digits, 2) = '55' THEN SUBSTRING(d.Digits, 3, 11)
                        ELSE d.Digits
                    END AS Canonical
                ) AS n
                WHERE c.Phone IS NOT NULL
                    AND c.Phone <> n.Canonical
                    AND n.Canonical NOT LIKE '%[^0-9]%'
                    AND LEFT(n.Canonical, 2) IN (
                        '11', '12', '13', '14', '15', '16', '17', '18', '19', '21', '22', '24', '27', '28',
                        '31', '32', '33', '34', '35', '37', '38', '41', '42', '43', '44', '45', '46', '47',
                        '48', '49', '51', '53', '54', '55', '61', '62', '63', '64', '65', '66', '67', '68',
                        '69', '71', '73', '74', '75', '77', '79', '81', '82', '83', '84', '85', '86', '87',
                        '88', '89', '91', '92', '93', '94', '95', '96', '97', '98', '99')
                    AND (
                        (LEN(n.Canonical) = 10 AND SUBSTRING(n.Canonical, 3, 1) BETWEEN '2' AND '5')
                        OR (LEN(n.Canonical) = 11 AND SUBSTRING(n.Canonical, 3, 1) = '9'));
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Sem volta: a máscara de antes não foi guardada, e o canônico continua válido no esquema anterior.
        }
    }
}
